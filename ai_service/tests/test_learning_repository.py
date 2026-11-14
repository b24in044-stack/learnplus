from types import SimpleNamespace
from uuid import uuid4

import pytest
from postgrest.exceptions import APIError

from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError
from ai_service.app.learning_repository import SupabaseLearningRepository

USER_ID = str(uuid4())
COURSE_ID = str(uuid4())
SUBJECT_ID = str(uuid4())


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.client.selections.append((table_name, None))
        self.filters = {}
        self.in_filters = {}
        self.is_single = False
        self.write_rows = None
        self.conflict = None

    def select(self, _fields):
        self.client.selections[-1] = (self.table_name, _fields)
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def in_(self, field, values):
        self.in_filters[field] = set(values)
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, _limit):
        return self

    def maybe_single(self):
        self.is_single = True
        return self

    def insert(self, values):
        self.write_rows = values
        return self

    def upsert(self, values, on_conflict=None):
        self.write_rows = values
        self.conflict = on_conflict
        return self

    def execute(self):
        if self.write_rows is not None:
            if self.table_name == "student_agent_records":
                rows = self.client.tables.setdefault(self.table_name, [])
                for existing in rows:
                    if all(existing.get(key) == self.write_rows.get(key) for key in (
                        "owner_id",
                        "record_type",
                        "legacy_id",
                    )):
                        existing.update(self.write_rows)
                        break
                else:
                    rows.append(self.write_rows)
            self.client.writes.append((self.table_name, self.write_rows))
            return SimpleNamespace(data=self.write_rows)

        rows = self.client.tables.get(self.table_name, [])
        if isinstance(rows, dict):
            rows = [rows]
        result = [
            row for row in rows
            if all(row.get(field) == value for field, value in self.filters.items())
            and all(row.get(field) in values for field, values in self.in_filters.items())
        ]
        return SimpleNamespace(data=(result[0] if result else None) if self.is_single else result)


class FakeRPC:
    def __init__(self, client, name, params):
        self.client = client
        self.name = name
        self.params = params

    def execute(self):
        self.client.rpc_calls.append((self.name, self.params))
        return SimpleNamespace(data=self.client.rpc_results.get(self.name))


class FakeSupabase:
    def __init__(self):
        self.tables = {
            "profiles": [{
                "id": USER_ID,
                "role": "student",
                "is_approved": True,
                "metadata": {"learningPreferences": ["visual examples"]},
                "legacy_data": {},
            }],
            "enrollments": [{
                "id": str(uuid4()),
                "student_id": USER_ID,
                "course_id": COURSE_ID,
                "status": "active",
            }],
            "courses": [{
                "id": COURSE_ID,
                "code": "CS 101",
                "title": "Computer Science",
                "instructor_id": str(uuid4()),
                "subject_id": SUBJECT_ID,
                "topics": [],
            }],
            "student_progress": [{
                "id": str(uuid4()),
                "student_id": USER_ID,
                "course_id": COURSE_ID,
                "topic_id": "loops",
                "topic_title": "Loops",
                "mastery_score": 80,
                "total_attempts": 2,
                "is_completed": True,
            }],
            "learning_activity": [],
            "assessment_submissions": [],
            "verified_subject_marks": [{
                "id": str(uuid4()),
                "student_id": USER_ID,
                "course_id": COURSE_ID,
                "subject_id": SUBJECT_ID,
                "marks": 87,
                "max_marks": 100,
                "verified_by": str(uuid4()),
                "verified_at": "2026-01-01T00:00:00+00:00",
            }],
            "semester_results": [],
            "course_materials": [{
                "id": str(uuid4()),
                "course_id": COURSE_ID,
                "title": "Loops notes",
                "published": True,
                "publication_status": "published",
            }],
            "student_agent_records": [],
        }
        self.writes = []
        self.rpc_calls = []
        self.selections = []
        self.rpc_results = {
            "record_concept_mastery_evidence": {
                "conceptId": "loops",
                "courseId": COURSE_ID,
                "evidenceCount": 1,
                "correctCount": 1,
                "masteryScore": 60,
            },
            "record_ai_learning_activity": str(uuid4()),
        }

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        return FakeRPC(self, name, params)


def repository(client):
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
    )
    return SupabaseLearningRepository(settings, "access-token", USER_ID, client=client)


def test_supabase_query_failures_log_only_safe_error_code(caplog):
    class FailedQuery:
        def execute(self):
            raise APIError({"code": "42703", "message": "column profiles.test_column does not exist"})

    with caplog.at_level("WARNING", logger="ai_service.app.learning_repository"):
        with pytest.raises(ServiceUnavailableError, match="learning data request failed"):
            SupabaseLearningRepository._run_query(FailedQuery())

    assert caplog.records[0].supabase_error_code == "42703"
    assert "missing column profiles.test_column" in caplog.text
    assert "access-token" not in caplog.text


def test_student_data_uses_trusted_client_and_validates_profile(monkeypatch):
    client = FakeSupabase()
    trusted_clients = []

    def create_trusted_client(settings):
        trusted_clients.append(settings)
        return client

    monkeypatch.setattr(
        "ai_service.app.learning_repository.create_admin_supabase_client",
        create_trusted_client,
    )
    settings = Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
    )
    repo = SupabaseLearningRepository(settings, "access-token", USER_ID)

    data = repo._load_student_data(COURSE_ID)

    assert data["courses"][0]["id"] == COURSE_ID
    assert trusted_clients == [settings]


@pytest.mark.asyncio
async def test_student_data_maps_only_authorized_supabase_records():
    client = FakeSupabase()

    data = await repository(client).get_student_data(COURSE_ID)

    assert data["profile"]["role"] == "student"
    assert "learningPreferences" not in data["profile"]
    assert data["courses"][0]["id"] == COURSE_ID
    assert data["courses"][0]["subjectId"] == SUBJECT_ID
    assert data["enrollments"][0]["studentUid"] == USER_ID
    assert data["progress"][0]["masteryScore"] == 80
    assert data["verified_marks"][0]["maximumScore"] == 100
    assert ("profiles", "id,email,role,is_approved,institution_id") in client.selections


@pytest.mark.asyncio
async def test_student_data_rejects_non_enrolled_course():
    with pytest.raises(ForbiddenError, match="not enrolled"):
        await repository(FakeSupabase()).get_student_data(str(uuid4()))


@pytest.mark.asyncio
async def test_published_materials_are_loaded_from_supabase_course_materials():
    materials = await repository(FakeSupabase()).get_course_materials(COURSE_ID)

    assert len(materials) == 1
    assert materials[0]["courseId"] == COURSE_ID
    assert materials[0]["publicationStatus"] == "published"


@pytest.mark.asyncio
async def test_agent_records_are_upserted_with_owner_and_record_type_scope():
    client = FakeSupabase()
    repo = repository(client)
    record = {"courseId": COURSE_ID, "conceptId": "loops", "masteryScore": 60}

    record_id = await repo.save_agent_record("concept_mastery", "loops", record)
    loaded = await repo.get_agent_record("concept_mastery", "loops")

    assert record_id == "loops"
    assert loaded["ownerUid"] == USER_ID
    assert loaded["conceptId"] == "loops"
    assert client.writes[0][1]["record_type"] == "concept_mastery"
    assert client.writes[0][1]["owner_id"] == USER_ID


@pytest.mark.asyncio
async def test_agent_record_type_is_allowlisted():
    with pytest.raises(ValueError, match="Unsupported"):
        await repository(FakeSupabase()).save_agent_record("profiles", "x", {})


@pytest.mark.asyncio
async def test_mastery_and_activity_use_atomic_user_scoped_rpcs():
    client = FakeSupabase()
    repo = repository(client)

    mastery = await repo.record_mastery_evidence("loops", "Loops", True, COURSE_ID, "assessment-1")
    await repo.record_learning_activity("practice_completed", COURSE_ID, "assessment-1")

    assert mastery["masteryScore"] == 60
    assert [name for name, _ in client.rpc_calls] == [
        "record_concept_mastery_evidence",
        "record_ai_learning_activity",
    ]
