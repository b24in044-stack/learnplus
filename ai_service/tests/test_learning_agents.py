import asyncio
import json
from copy import deepcopy

import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient

from ai_service.app.agents.learning import (
    ExplainabilityAgent,
    KnowledgeGraphAgent,
    KnowledgeTracingAgent,
    LearningAnalyticsAgent,
    RecommendationAgent,
    StudentModelingAgent,
    create_learning_agent_services,
)
from ai_service.app.auth import AuthenticatedUser
from ai_service.app.config import Settings
from ai_service.app.coordinator import Coordinator
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from ai_service.app.main import create_app
from ai_service.app.providers.base import Generation


class FakeLearningRepository:
    def __init__(self, user_id="student-1"):
        self.user_id = user_id
        self.records = {}
        self.data = {
            "profile": {"learningPreferences": ["visual examples"]},
            "enrollments": [{"studentUid": user_id, "courseId": "course-1"}],
            "courses": [{
                "id": "course-1",
                "code": "CS 101",
                "title": "Computer Science",
                "subjectId": "subject-1",
                "topics": [
                    {"id": "basics", "title": "Programming Basics", "prerequisites": []},
                    {"id": "loops", "title": "Loops", "prerequisites": ["basics", "missing-topic"]},
                ],
            }],
            "progress": [{"studentUid": user_id, "courseId": "course-1", "topicTitle": "Loops"}],
            "activity": [{"studentUid": user_id, "courseId": "course-1", "activityType": "study"}],
            "assessment_submissions": [],
            "verified_marks": [{
                "studentUid": user_id,
                "courseId": "course-1",
                "subjectId": "subject-1",
                "score": 87,
                "maximumScore": 100,
                "verifiedByUid": "faculty-1",
            }],
            "semester_results": [],
        }

    async def get_student_data(self, course_id=None):
        if course_id and course_id != "course-1":
            raise ForbiddenError("The authenticated student is not enrolled in this course.")
        data = deepcopy(self.data)
        if course_id:
            data["courses"] = [course for course in data["courses"] if course["id"] == course_id]
        return data

    async def get_course_materials(self, course_id):
        if course_id != "course-1":
            raise ForbiddenError("The authenticated student is not enrolled in this course.")
        return [{"id": "material-1", "courseId": course_id, "title": "Loops tutorial"}]

    async def get_agent_record(self, collection_name, record_id):
        record = self.records.get(collection_name, {}).get(record_id)
        if not record or record["ownerUid"] != self.user_id:
            return None
        return deepcopy({"id": record_id, **record})

    async def list_agent_records(self, collection_name, limit=500):
        records = self.records.get(collection_name, {})
        return [
            {"id": key, **deepcopy(value)}
            for key, value in list(records.items())[:limit]
            if value.get("ownerUid") == self.user_id
        ]

    async def save_agent_record(self, collection_name, record_id, data, merge=False):
        collection = self.records.setdefault(collection_name, {})
        old = collection.get(record_id, {}) if merge else {}
        collection[record_id] = {**old, **deepcopy(data), "ownerUid": self.user_id}
        return record_id

    async def record_mastery_evidence(self, concept_id, concept_title, correct, course_id, source_id):
        await self.get_student_data(course_id)
        records = self.records.setdefault("concept_mastery", {})
        record = records.get(concept_id, {})
        evidence_count = record.get("evidenceCount", 0) + 1
        correct_count = record.get("correctCount", 0) + int(correct)
        value = {
            "ownerUid": self.user_id,
            "courseId": course_id,
            "conceptId": concept_id,
            "conceptTitle": concept_title,
            "evidenceCount": evidence_count,
            "correctCount": correct_count,
            "masteryScore": round(100 * (2 + correct_count) / (4 + evidence_count), 1),
            "method": "Beta(2, 2) prior; one Bernoulli evidence per graded practice response",
            "estimated": True,
            "lastEvidenceId": source_id,
        }
        records[concept_id] = value
        return deepcopy(value)

    async def record_learning_activity(self, activity_type, course_id, assessment_id):
        await self.get_student_data(course_id)
        activities = self.records.setdefault("activity_log", {})
        activities[assessment_id] = {
            "ownerUid": self.user_id,
            "activityType": activity_type,
            "courseId": course_id,
        }


class FakeProvider:
    name = "test-groq"
    model = "test-model"

    def __init__(self, response=None):
        self.response = response
        self.messages = []

    async def generate(self, messages, max_tokens):
        self.messages.append(messages)
        if self.response is not None:
            text = self.response
        elif "Grade the student's practice responses" in messages[-1]["content"]:
            request = json.loads(messages[-1]["content"])
            text = json.dumps({
                "evaluations": [
                    {"id": item["id"], "score": 80, "feedback": "Your response addresses the main point."}
                    for item in request["items"]
                ],
            })
        else:
            text = json.dumps({
                "title": "Loops practice",
                "questions": [{
                    "question": "Which construct repeats a block?",
                    "topic": "Loops",
                    "options": ["loop", "class", "module", "comment"],
                    "answer_index": 0,
                    "explanation": "A loop repeats a block of instructions.",
                }],
            })
        return Generation(text, 20, 10, self.model)

    async def health_check(self):
        return True


class FakeTutor:
    async def answer(self, history, question, sources=None, learning_context=None):
        return "Tutor response.", {
            "provider": "test-groq",
            "model": "test-model",
            "input_tokens": 1,
            "output_tokens": 1,
        }


def build_agents(repository=None, provider=None, settings=None):
    repo = repository or FakeLearningRepository()
    config = settings or Settings(_env_file=None, groq_api_key=SecretStr("test-key"))
    return create_learning_agent_services(provider or FakeProvider(), config, repo), repo, config


@pytest.mark.asyncio
async def test_student_model_uses_only_owned_profile_and_explicit_preferences():
    agents, repository, _ = build_agents()

    result = await agents.student_modeling.build_profile("course-1")

    assert result["enrolledCourses"][0]["courseId"] == "course-1"
    assert result["learningPreferences"] == ["visual examples"]
    assert result["preferenceEvidence"] == "explicitly provided"
    assert repository.records["learning_profiles"]["current"]["ownerUid"] == repository.user_id
    with pytest.raises(ForbiddenError):
        await agents.student_modeling.build_profile("another-student-course")


@pytest.mark.asyncio
async def test_knowledge_tracing_uses_documented_beta_evidence_update():
    agents, _, _ = build_agents()

    first = await agents.knowledge_tracing.update_from_responses(
        "course-1",
        "assessment-1",
        [{"concept_id": "loops", "topic": "Loops", "mastered": True}],
    )
    second = await agents.knowledge_tracing.update_from_responses(
        "course-1",
        "assessment-2",
        [{"concept_id": "loops", "topic": "Loops", "mastered": False}],
    )

    assert first[0]["masteryScore"] == 60
    assert second[0]["masteryScore"] == 50
    assert second[0]["evidenceCount"] == 2
    assert second[0]["estimated"] is True
    assert "Beta(2, 2)" in second[0]["method"]


@pytest.mark.asyncio
async def test_learning_analytics_keeps_verified_marks_separate_from_practice_estimates():
    agents, repository, _ = build_agents()
    repository.records["practice_submissions"] = {
        "practice-1": {
            "ownerUid": repository.user_id,
            "courseId": "course-1",
            "percentage": 40,
        },
    }

    result = await agents.learning_analytics.analyze("course-1")

    assert result["aiPractice"]["averageScore"] == 40
    assert result["verifiedAcademicMarks"][0]["score"] == 87
    assert result["verifiedAcademicMarks"][0]["source"] == "verified_subject_marks"
    assert result["estimatedConceptMastery"] == []


@pytest.mark.asyncio
async def test_knowledge_graph_only_emits_explicit_prerequisite_edges():
    agents, _, _ = build_agents()

    graph = await agents.knowledge_graph.build("course-1")

    assert len(graph["concepts"]) == 2
    assert graph["relationships"] == [{
        "from": "basics",
        "to": "loops",
        "relation": "prerequisite",
        "source": "explicit prerequisite field in enrolled course record",
    }]
    assert "missing-topic" not in str(graph["relationships"])


@pytest.mark.asyncio
async def test_assessment_agent_generates_private_answer_key_and_grades_practice():
    agents, repository, _ = build_agents()

    generated = await agents.assessment.generate(
        "course-1",
        "Loops",
        "Intermediate",
        ["Explain loop control flow"],
        1,
        "mcq",
    )
    question = generated["questions"][0]
    saved = repository.records["practice_assessments"][generated["assessmentId"]]

    assert generated["aiGenerated"] is True
    assert generated["official"] is False
    assert "answer_index" not in question
    assert saved["questions"][0]["answer_index"] == 0

    result = await agents.assessment.evaluate(generated["assessmentId"], {question["id"]: 1})

    assert result["percentage"] == 0
    assert result["official"] is False
    assert result["questionResults"][0]["score"] == 0
    assert "correctOption" not in result["questionResults"][0]
    assert repository.records["activity_log"][generated["assessmentId"]]["activityType"] == "ai_practice_assessment_completed"
    assert repository.records["concept_mastery"]["loops"]["masteryScore"] == 40


@pytest.mark.asyncio
async def test_assessment_agent_generates_and_grades_descriptive_practice():
    class DescriptiveProvider(FakeProvider):
        async def generate(self, messages, max_tokens):
            self.messages.append(messages)
            if "Grade the student's practice responses" in messages[-1]["content"]:
                request = json.loads(messages[-1]["content"])
                text = json.dumps({
                    "evaluations": [{
                        "id": request["items"][0]["id"],
                        "score": 80,
                        "feedback": "Your response explains the loop condition.",
                    }],
                })
            else:
                text = json.dumps({
                    "title": "Loop explanation practice",
                    "questions": [{
                        "question": "Explain how a while loop terminates.",
                        "topic": "Loops",
                        "reference_answer": "It terminates when its condition becomes false.",
                        "rubric": ["Identifies the loop condition", "Explains condition changes"],
                        "explanation": "The condition is checked before each iteration.",
                    }],
                })
            return Generation(text, 20, 10, self.model)

    agents, repository, _ = build_agents(provider=DescriptiveProvider())

    generated = await agents.assessment.generate(
        "course-1",
        "Loops",
        "Intermediate",
        [],
        1,
        "descriptive",
    )
    question = generated["questions"][0]
    saved_assessment = repository.records["practice_assessments"][generated["assessmentId"]]

    assert question["format"] == "descriptive"
    assert "reference_answer" not in question
    assert "rubric" not in question
    assert saved_assessment["questions"][0]["reference_answer"]

    result = await agents.assessment.evaluate(generated["assessmentId"], {
        question["id"]: "The loop exits when the condition becomes false.",
    })

    assert result["questionResults"][0]["score"] == 80
    assert "not an official" in result["evidenceNote"]
    assert repository.records["concept_mastery"]["loops"]["evidenceCount"] == 1


@pytest.mark.asyncio
async def test_recommendation_agent_uses_weak_evidence_and_published_materials():
    agents, _, _ = build_agents()
    await agents.knowledge_tracing.update_from_responses(
        "course-1",
        "assessment-1",
        [{"concept_id": "loops", "topic": "Loops", "mastered": False}],
    )

    result = await agents.recommendation.recommend("course-1")

    assert result["recommendations"][0]["topic"] == "Loops"
    assert result["recommendations"][0]["materials"] == [{"id": "material-1", "title": "Loops tutorial"}]
    assert "practice" in result["recommendations"][0]["practiceAction"].lower()


@pytest.mark.asyncio
async def test_explainability_reports_provenance_without_internal_reasoning():
    result = await ExplainabilityAgent.explain(
        {"score": 80},
        [{"source": "practice", "fields": ["score"]}],
    )

    assert result["evidence"] == [{"source": "practice", "fields": ["score"]}]
    assert "estimated" in result["provenance"]
    assert "chainOfThought" in result
    assert "reasoning" not in result


@pytest.mark.asyncio
async def test_coordinator_personalized_workflow_runs_specialists_in_order():
    services, _, _ = build_agents()
    coordinator = Coordinator(FakeTutor(), services)

    workflow = await coordinator.execute("personalized_learning", course_id="course-1")

    assert workflow.task_type == "personalized_learning"
    assert [step["agent_id"] for step in workflow.agent_steps] == [
        "student_modeling",
        "knowledge_tracing",
        "learning_analytics",
        "recommendation",
        "explainability",
    ]
    assert workflow.data["profile"]["enrolledCourses"][0]["courseId"] == "course-1"


@pytest.mark.asyncio
async def test_tutor_coordinator_uses_course_context_without_creating_fake_citations():
    services, _, _ = build_agents()
    coordinator = Coordinator(FakeTutor(), services)
    graph = await services.knowledge_graph.build("course-1")

    result = await coordinator.handle([], "Explain loops.", learning_context=graph)

    assert result.content == "Tutor response."
    assert result.intent == "tutoring"


@pytest.mark.asyncio
async def test_student_requests_are_isolated_under_concurrent_execution():
    first, first_repository, _ = build_agents(FakeLearningRepository("student-1"))
    second, second_repository, _ = build_agents(FakeLearningRepository("student-2"))

    profiles = await asyncio.gather(
        first.student_modeling.build_profile("course-1"),
        second.student_modeling.build_profile("course-1"),
    )

    assert profiles[0]["enrolledCourses"] == profiles[1]["enrolledCourses"]
    assert first_repository.user_id != second_repository.user_id
    assert first_repository.records["learning_profiles"]["current"]["ownerUid"] == "student-1"
    assert second_repository.records["learning_profiles"]["current"]["ownerUid"] == "student-2"


@pytest.mark.asyncio
async def test_assessment_timeout_is_reported_as_unavailable():
    class SlowProvider(FakeProvider):
        async def generate(self, messages, max_tokens):
            await asyncio.sleep(0.05)
            return await super().generate(messages, max_tokens)

    settings = Settings(
        _env_file=None,
        groq_api_key=SecretStr("test-key"),
        provider_timeout_seconds=0.01,
    )
    agents, _, _ = build_agents(provider=SlowProvider(), settings=settings)

    with pytest.raises(ServiceUnavailableError, match="timed out"):
        await agents.assessment.generate("course-1", "Loops", "Intermediate", [], 1, "mcq")


def build_api_client(repository, provider):
    settings = Settings(
        _env_file=None,
        groq_api_key=SecretStr("test-key"),
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="test-publishable-key",
        embedding_enabled=False,
    )

    async def authenticate(authorization, _settings):
        if authorization != "Bearer valid-token":
            raise UnauthorizedError("A valid Supabase access token is required.")
        return AuthenticatedUser(id=repository.user_id, role="student")

    return TestClient(create_app(
        settings,
        provider_override=provider,
        auth_override=authenticate,
        learning_repository_factory=lambda _settings, _user_id: repository,
    ))


def test_authenticated_coordinator_routes_real_multi_agent_workflows():
    repository = FakeLearningRepository()
    client = build_api_client(repository, FakeProvider())
    headers = {"Authorization": "Bearer valid-token"}

    status = client.get("/api/v1/agents/status", headers=headers)
    assert status.status_code == 200
    status_payload = status.json()
    assert len(status_payload["agents"]) == 8
    assert set(status_payload["available"]) == {item["agent_id"] for item in status_payload["agents"]}

    personalized = client.post(
        "/api/v1/agents/personalized-learning",
        headers=headers,
        json={"course_id": "course-1"},
    )
    assert personalized.status_code == 200, personalized.text
    assert [step["agent_id"] for step in personalized.json()["agent_steps"]] == [
        "student_modeling",
        "knowledge_tracing",
        "learning_analytics",
        "recommendation",
        "explainability",
    ]

    generated = client.post(
        "/api/v1/agents/assessments",
        headers=headers,
        json={
            "course_id": "course-1",
            "topic": "Loops",
            "difficulty": "Intermediate",
            "learning_objectives": ["Trace loop control flow"],
            "question_count": 1,
            "question_format": "mcq",
        },
    )
    assert generated.status_code == 200, generated.text
    assessment = generated.json()["data"]
    question = assessment["questions"][0]
    assert "answer_index" not in question

    evaluated = client.post(
        f"/api/v1/agents/assessments/{assessment['assessmentId']}/submit",
        headers=headers,
        json={"answers": {question["id"]: 0}},
    )
    assert evaluated.status_code == 200, evaluated.text
    assert [step["agent_id"] for step in evaluated.json()["agent_steps"]] == [
        "assessment",
        "learning_analytics",
        "recommendation",
        "explainability",
    ]
    assert evaluated.json()["data"]["official"] is False


def test_coordinator_rejects_missing_auth_foreign_enrollment_and_client_uid():
    repository = FakeLearningRepository()
    client = build_api_client(repository, FakeProvider())

    unauthorized = client.post(
        "/api/v1/agents/personalized-learning",
        json={"course_id": "course-1"},
    )
    assert unauthorized.status_code == 401

    foreign_course = client.post(
        "/api/v1/agents/personalized-learning",
        headers={"Authorization": "Bearer valid-token"},
        json={"course_id": "another-student-course"},
    )
    assert foreign_course.status_code == 403

    spoofed_identity = client.post(
        "/api/v1/agents/execute",
        headers={"Authorization": "Bearer valid-token"},
        json={"task_type": "student_modeling", "user_id": "student-2"},
    )
    assert spoofed_identity.status_code == 422
