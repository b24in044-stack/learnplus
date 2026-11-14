from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr

from ai_service.app.auth import AuthenticatedUser
from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, UnauthorizedError
from ai_service.app.main import create_app
from ai_service.app.providers.base import Generation


USER_ID = UUID("32b180c7-6a41-4aeb-b4a9-64ecec6d4bb9")


class FakeProvider:
    name = "fake-unit-provider"
    model = "fake-model"

    async def generate(self, messages, max_tokens):
        assert messages[-1]["content"] == "Explain binary search."
        assert max_tokens == 120
        return Generation("Binary search halves the sorted search range each step.", 22, 14, self.model)

    async def health_check(self):
        return True


class FacultyAssessmentProvider:
    name = "fake-unit-provider"
    model = "fake-model"

    async def generate(self, messages, max_tokens):
        assert messages[0]["role"] == "system"
        assert "faculty review" in messages[0]["content"].lower()
        return Generation(
            '{"title":"Loops and Invariants","questions":[{"questionText":"What does this loop compute?",'
            '"topicTag":"Loops","options":["A count","A sum"],"correctOptionIndex":1,'
            '"explanation":"The loop accumulates each value."}]}',
            20,
            30,
            self.model,
        )

    async def health_check(self):
        return True


class FakeFacultyLearningRepository:
    def __init__(self, _settings, user_id):
        assert user_id == "faculty-1"

    async def get_faculty_course(self, course_id):
        if course_id != "course-1":
            raise ForbiddenError("The requested course is not assigned to this faculty account.")
        return {"id": course_id, "code": "CS 101", "title": "Computer Science"}


class FakeStore:
    def __init__(self, _settings, token, user_id):
        assert token == "valid-test-token"
        assert user_id == USER_ID
        self.saved = None

    async def get_history(self, session_id, user_id, limit):
        assert user_id == USER_ID
        assert limit == 5
        return []

    async def save_turn(self, session_id, user_content, assistant_content, metadata):
        self.saved = (session_id, user_content, assistant_content, metadata)
        return uuid4()


def test_health_does_not_claim_rag_or_leak_provider_credentials(caplog):
    settings = Settings(_env_file=None, groq_api_key=SecretStr("private-key"))
    client = TestClient(create_app(settings))
    response = client.get("/health")
    payload = response.json()

    assert response.status_code == 200
    assert payload["provider_configured"] is True
    assert payload["rag_configured"] is False
    assert "rag_available" not in payload
    assert "private-key" not in response.text
    assert "private-key" not in caplog.text


def test_supabase_configuration_requires_url_and_publishable_key():
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
    )
    assert settings.supabase_is_configured is True
    assert Settings(_env_file=None).supabase_is_configured is False


def test_chat_requires_supabase_bearer_authentication():
    client = TestClient(create_app(Settings(_env_file=None)))
    response = client.post("/v1/chat", json={"session_id": str(uuid4()), "message": "Question"})

    assert response.status_code == 401


def test_chat_rejects_invalid_request_and_client_supplied_identity():
    settings = Settings(_env_file=None, groq_api_key=SecretStr("test"))
    client = TestClient(create_app(settings, provider_override=FakeProvider()))
    response = client.post(
        "/v1/chat",
        headers={"Authorization": "Bearer token"},
        json={"session_id": str(uuid4()), "message": "Question", "user_id": str(USER_ID)},
    )

    assert response.status_code == 422


def test_chat_persists_provider_answer_and_returns_execution_metadata():
    settings = Settings(
        _env_file=None,
        groq_api_key=SecretStr("private-key"),
        max_output_tokens=120,
        max_history_messages=5,
    )

    async def authenticate(authorization, _settings):
        if authorization != "Bearer valid-test-token":
            raise UnauthorizedError("A valid Supabase access token is required.")
        return AuthenticatedUser(id=USER_ID, role="student")

    store = FakeStore(settings, "valid-test-token", USER_ID)
    client = TestClient(create_app(
        settings,
        provider_override=FakeProvider(),
        auth_override=authenticate,
        store_factory=lambda _settings, token, user_id: store,
    ))
    session_id = uuid4()
    response = client.post(
        "/v1/chat",
        headers={"Authorization": "Bearer valid-test-token"},
        json={"session_id": str(session_id), "message": "Explain binary search."},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["session_id"] == str(session_id)
    assert payload["content"].startswith("Binary search")
    assert payload["citations"] == []
    assert [step["agent_id"] for step in payload["agent_steps"]] == ["coordinator", "tutor"]
    assert store.saved[1] == "Explain binary search."
    assert store.saved[2] == payload["content"]
    assert store.saved[3]["provider"] == "fake-unit-provider"


def test_service_returns_unavailable_without_configured_provider():
    settings = Settings(_env_file=None)
    async def authenticate(authorization, _settings):
        if authorization != "Bearer valid-test-token":
            raise UnauthorizedError("A valid Supabase access token is required.")
        return AuthenticatedUser(id=USER_ID, role="student")

    client = TestClient(create_app(settings, auth_override=authenticate))
    response = client.post(
        "/v1/chat",
        headers={"Authorization": "Bearer valid-test-token"},
        json={"session_id": str(uuid4()), "message": "Explain binary search."},
    )

    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_faculty_assessment_draft_is_generated_for_assigned_course():
    async def authenticate(authorization, _settings):
        assert authorization == "******"
        return AuthenticatedUser(id="faculty-1", role="faculty")

    client = TestClient(create_app(
        Settings(_env_file=None, groq_api_key=SecretStr("private-key")),
        provider_override=FacultyAssessmentProvider(),
        auth_override=authenticate,
        learning_repository_factory=FakeFacultyLearningRepository,
    ))
    response = client.post(
        "/api/v1/agents/faculty/assessments",
        headers={"Authorization": "******"},
        json={
            "courseId": "course-1",
            "topic": "Loops",
            "difficulty": "Beginner",
            "questionCount": 1,
            "bloomLevel": "Application",
        },
    )

    assert response.status_code == 200, response.text
    draft = response.json()
    assert draft["courseId"] == "course-1"
    assert draft["courseCode"] == "CS 101"
    assert draft["status"] == "draft"
    assert draft["questions"][0]["correctOptionIndex"] == 1
    assert "private-key" not in response.text


def test_faculty_assessment_draft_rejects_student_role_and_invalid_payload():
    async def authenticate(authorization, _settings):
        return AuthenticatedUser(id="student-1", role="student")

    client = TestClient(create_app(
        Settings(_env_file=None),
        auth_override=authenticate,
        learning_repository_factory=FakeFacultyLearningRepository,
    ))
    headers = {"Authorization": "******"}
    valid_payload = {
        "courseId": "course-1",
        "topic": "Loops",
        "difficulty": "Beginner",
        "questionCount": 1,
    }

    forbidden = client.post("/api/v1/agents/faculty/assessments", headers=headers, json=valid_payload)
    invalid = client.post(
        "/api/v1/agents/faculty/assessments",
        headers=headers,
        json={**valid_payload, "questionCount": 0},
    )

    assert forbidden.status_code == 403
    assert invalid.status_code == 422


def test_faculty_assessment_draft_rejects_unassigned_course():
    async def authenticate(authorization, _settings):
        return AuthenticatedUser(id="faculty-1", role="faculty")

    client = TestClient(create_app(
        Settings(_env_file=None, groq_api_key=SecretStr("private-key")),
        provider_override=FacultyAssessmentProvider(),
        auth_override=authenticate,
        learning_repository_factory=FakeFacultyLearningRepository,
    ))
    response = client.post(
        "/api/v1/agents/faculty/assessments",
        headers={"Authorization": "******"},
        json={
            "courseId": "another-course",
            "topic": "Loops",
            "difficulty": "Beginner",
            "questionCount": 1,
        },
    )

    assert response.status_code == 403


def test_faculty_assessment_draft_rejects_malformed_groq_output():
    class MalformedProvider(FacultyAssessmentProvider):
        async def generate(self, _messages, _max_tokens):
            return Generation('{"title":"Missing questions"}', 5, 5, self.model)

    async def authenticate(authorization, _settings):
        return AuthenticatedUser(id="faculty-1", role="faculty")

    client = TestClient(create_app(
        Settings(_env_file=None, groq_api_key=SecretStr("private-key")),
        provider_override=MalformedProvider(),
        auth_override=authenticate,
        learning_repository_factory=FakeFacultyLearningRepository,
    ))
    response = client.post(
        "/api/v1/agents/faculty/assessments",
        headers={"Authorization": "******"},
        json={
            "courseId": "course-1",
            "topic": "Loops",
            "difficulty": "Beginner",
            "questionCount": 1,
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Groq returned an invalid faculty assessment draft."
    assert "private-key" not in response.text
