from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr

from ai_service.app.auth import AuthenticatedUser
from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from ai_service.app.main import create_app
from ai_service.app.providers.base import Generation


USER_ID = UUID("32b180c7-6a41-4aeb-b4a9-64ecec6d4bb9")
DOCUMENT_ID = uuid4()
CHUNK_ID = uuid4()
COURSE_ID = "course-cs101"


class FakeEmbeddings:
    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    dimension = 384

    async def load(self):
        return None

    async def embed_documents(self, texts):
        assert texts
        return [[1.0] + [0.0] * 383 for _ in texts]

    async def embed_query(self, _query):
        return [1.0] + [0.0] * 383


class FakeRAGRepository:
    def __init__(self, _settings, token, user_id, *, no_matches=False, empty_file=False):
        assert token == "verified-access-token"
        assert user_id == USER_ID
        self.no_matches = no_matches
        self.empty_file = empty_file
        self.statuses = []
        self.persisted = None
        self.searched_course_id = None
        self.requested_course_id = None

    async def get_document(self, document_id, course_id=None):
        assert document_id == DOCUMENT_ID
        self.requested_course_id = course_id
        return {
            "id": str(DOCUMENT_ID),
            "owner_id": str(USER_ID),
            "course_id": course_id or str(uuid4()),
            "storage_path": f"{USER_ID}/course/notes.txt",
            "title": "Lecture notes",
            "file_type": "text",
            "file_size_bytes": 100,
            "status": "uploaded",
            "metadata": {},
        }

    async def begin_processing(self, _document_id, _course_id=None):
        self.statuses.append("processing")

    async def set_status(self, _document_id, status, metadata=None, course_id=None):
        self.statuses.append(status)
        if metadata:
            self.persisted = metadata

    async def download(self, _storage_path, _document_id=None, _course_id=None):
        return b"" if self.empty_file else b"Recursion is a function that calls itself."

    async def replace_chunks(self, document, chunks, vectors):
        assert document["owner_id"] == str(USER_ID)
        assert len(chunks) == len(vectors) == 1

    async def search(self, _query_vector, limit=5, course_id=None):
        assert limit in {1, 5}
        self.searched_course_id = course_id
        if self.no_matches:
            return []
        return [{
            "chunk_id": str(CHUNK_ID),
            "chunk_index": 4,
            "document_id": str(DOCUMENT_ID),
            "document_title": "Lecture notes",
            "page_number": 3,
            "content": "Recursion is a function that calls itself.",
            "similarity": 0.88,
        }]


class FakeProvider:
    name = "groq-unit-test"
    model = "fake-model"

    def __init__(self):
        self.messages = None

    async def generate(self, messages, max_tokens):
        assert max_tokens == 150
        self.messages = messages
        return Generation("Recursion calls the same function again. [Source 1]", 20, 10, self.model)

    async def health_check(self):
        return True


class FakeConversationStore:
    def __init__(self, _settings, token, user_id):
        assert token == "verified-access-token"
        assert user_id == USER_ID
        self.metadata = None

    async def get_history(self, _session_id, user_id, _limit):
        assert user_id == USER_ID
        return []

    async def save_turn(self, _session_id, _question, _answer, metadata):
        self.metadata = metadata
        return uuid4()


class FakeLearningRepository:
    async def get_student_data(self, course_id=None):
        if course_id and course_id != COURSE_ID:
            raise ForbiddenError("The authenticated student is not enrolled in this course.")
        return {
            "profile": {},
            "enrollments": [{"studentUid": str(USER_ID), "courseId": COURSE_ID}],
            "courses": [{
                "id": COURSE_ID,
                "title": "Computer Science",
                "topics": [{"id": "recursion", "title": "Recursion", "prerequisites": []}],
            }],
            "progress": [],
            "activity": [],
            "assessment_submissions": [],
            "verified_marks": [],
            "semester_results": [],
        }


def build_client(repository, provider=None, settings_overrides=None):
    settings_values = {
        "groq_api_key": SecretStr("test-provider-key"),
        "supabase_url": "https://project.supabase.co",
        "supabase_publishable_key": "test-publishable-key",
        "max_output_tokens": 150,
    }
    settings_values.update(settings_overrides or {})
    settings = Settings(
        _env_file=None,
        **settings_values,
    )

    async def authenticate(authorization, _settings):
        if authorization != "Bearer verified-access-token":
            raise UnauthorizedError("A valid Supabase access token is required.")
        return AuthenticatedUser(USER_ID, "student")

    store = FakeConversationStore(settings, "verified-access-token", USER_ID)
    app = create_app(
        settings,
        provider_override=provider,
        auth_override=authenticate,
        store_factory=lambda _settings, token, user_id: store,
        embedding_override=FakeEmbeddings(),
        rag_repository_factory=lambda _settings, token, user_id: repository(
            _settings,
            token,
            user_id,
        ),
        learning_repository_factory=lambda _settings, user_id: FakeLearningRepository(),
    )
    return TestClient(app), store


def test_document_ingestion_returns_actual_extraction_and_embedding_result():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID)},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "document_id": str(DOCUMENT_ID),
        "status": "ready",
        "chunks_count": 1,
        "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
    }
    assert repository.statuses == ["processing"]


def test_document_ingestion_passes_selected_course_context_to_repository():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID), "course_id": COURSE_ID},
    )

    assert response.status_code == 200
    assert repository.requested_course_id == COURSE_ID


def test_document_ingestion_marks_unreadable_content_failed():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID, empty_file=True)
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID)},
    )

    assert response.status_code == 422
    assert "empty" in response.json()["detail"].lower()
    assert repository.statuses == ["processing", "failed"]


def test_document_ingestion_marks_storage_authorization_failure_failed():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)

    async def reject_download(_storage_path, _document_id=None, _course_id=None):
        raise ForbiddenError("The authenticated account cannot access this document.")

    repository.download = reject_download
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID)},
    )

    assert response.status_code == 403
    assert repository.statuses == ["processing", "failed"]


def test_document_ingestion_reports_storage_unavailability_and_marks_failed():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)

    async def fail_download(_storage_path, _document_id=None, _course_id=None):
        raise ServiceUnavailableError("Supabase Storage document download failed.")

    repository.download = fail_download
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID)},
    )

    assert response.status_code == 503
    assert "Storage document download failed" in response.json()["detail"]
    assert repository.statuses == ["processing", "failed"]


def test_ingestion_rejects_oversized_chunk_batch_and_marks_document_failed():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)

    async def download_many_words(_storage_path, _document_id=None, _course_id=None):
        return b"word " * 110

    repository.download = download_many_words
    client, _ = build_client(
        lambda *_args: repository,
        settings_overrides={
            "rag_chunk_size": 100,
            "rag_chunk_overlap": 99,
            "rag_max_chunks": 2,
        },
    )

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID)},
    )

    assert response.status_code == 413
    assert "maximum of 2 chunks" in response.json()["detail"]
    assert repository.statuses == ["processing", "failed"]


def test_ingestion_rejects_client_supplied_owner_identity():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/documents/ingest",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"document_id": str(DOCUMENT_ID), "owner_id": str(uuid4())},
    )

    assert response.status_code == 422


def test_document_grounded_chat_returns_only_real_retrieved_citations():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    provider = FakeProvider()
    client, store = build_client(lambda *_args: repository, provider)
    session_id = uuid4()

    response = client.post(
        "/api/v1/chat",
        headers={"Authorization": "Bearer verified-access-token"},
        json={
            "session_id": str(session_id),
            "message": "Explain recursion using my notes.",
            "use_documents": True,
            "course_id": COURSE_ID,
        },
    )

    assert response.status_code == 200, response.text
    citation = response.json()["citations"][0]
    assert citation["source_chunk_id"] == str(CHUNK_ID)
    assert citation["chunk_index"] == 4
    assert citation["document_id"] == str(DOCUMENT_ID)
    assert citation["page_number"] == 3
    assert citation["similarity"] == 0.88
    assert "Lecture notes, page 3" in provider.messages[-1]["content"]
    assert store.metadata["source_chunk_ids"] == [str(CHUNK_ID)]
    assert repository.searched_course_id == COURSE_ID


def test_document_grounded_chat_does_not_call_llm_when_no_sources_exist():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID, no_matches=True)
    provider = FakeProvider()
    client, _ = build_client(lambda *_args: repository, provider)

    response = client.post(
        "/api/v1/chat",
        headers={"Authorization": "Bearer verified-access-token"},
        json={
            "session_id": str(uuid4()),
            "message": "What do my notes say?",
            "use_documents": True,
            "course_id": COURSE_ID,
        },
    )

    assert response.status_code == 404
    assert "do not contain a sufficiently relevant passage" in response.json()["detail"]
    assert provider.messages is None


def test_grounded_chat_rejects_prompt_context_exceeding_limit_before_provider_call():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    provider = FakeProvider()
    client, store = build_client(
        lambda *_args: repository,
        provider,
        settings_overrides={"max_input_characters": 500},
    )

    response = client.post(
        "/api/v1/chat",
        headers={"Authorization": "Bearer verified-access-token"},
        json={
            "session_id": str(uuid4()),
            "message": "Explain recursion using my notes.",
            "use_documents": True,
            "course_id": COURSE_ID,
        },
    )

    assert response.status_code == 413
    assert provider.messages is None
    assert store.metadata is None


def test_document_grounded_chat_requires_a_selected_course():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    provider = FakeProvider()
    client, _ = build_client(lambda *_args: repository, provider)

    response = client.post(
        "/api/v1/chat",
        headers={"Authorization": "Bearer verified-access-token"},
        json={
            "session_id": str(uuid4()),
            "message": "Explain recursion using my notes.",
            "use_documents": True,
        },
    )

    assert response.status_code == 422
    assert provider.messages is None


def test_rag_search_requires_course_context_and_returns_source_chunk_metadata():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    client, _ = build_client(lambda *_args: repository)

    response = client.post(
        "/api/v1/rag/search",
        headers={"Authorization": "Bearer verified-access-token"},
        json={"course_id": COURSE_ID, "query": "recursion", "limit": 1},
    )

    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["chunk_id"] == str(CHUNK_ID)
    assert result["chunk_index"] == 4
    assert result["page_number"] == 3
    assert repository.searched_course_id == COURSE_ID


def test_agent_status_reports_rag_ready_only_after_authenticated_database_probe():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)
    client, _ = build_client(lambda *_args: repository)

    response = client.get(
        "/api/v1/agents/status",
        headers={"Authorization": "Bearer verified-access-token"},
    )

    assert response.status_code == 200
    assert response.json()["rag_available"] is True


def test_agent_status_reports_rag_unavailable_when_database_probe_fails():
    repository = FakeRAGRepository(None, "verified-access-token", USER_ID)

    async def fail_search(_query_vector, limit=5):
        raise ServiceUnavailableError("The vector database is unavailable.")

    repository.search = fail_search
    client, _ = build_client(lambda *_args: repository)

    response = client.get(
        "/api/v1/agents/status",
        headers={"Authorization": "Bearer verified-access-token"},
    )

    assert response.status_code == 200
    assert response.json()["rag_available"] is False
