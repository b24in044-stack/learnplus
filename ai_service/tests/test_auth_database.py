from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from ai_service.app import auth as auth_module
from ai_service.app.config import Settings
from ai_service.app.database import SupabaseConversationStore
from ai_service.app.errors import ConversationNotFoundError, ForbiddenError

USER_ID = "32b180c7-6a41-4aeb-b4a9-64ecec6d4bb9"
SESSION_ID = UUID("9e75e012-fac3-4ba2-832e-81cc5eafc805")
ASSISTANT_MESSAGE_ID = UUID("f5201a27-6e91-4bc4-a856-5739966f7a20")


def configured_settings():
    return Settings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="publishable-key",
        supabase_service_role_key="service-role-key",
    )


@pytest.mark.asyncio
async def test_auth_verifies_supabase_token_and_loads_server_role(monkeypatch):
    class FakeAuth:
        def get_user(self, token):
            assert token == "access-token"
            return SimpleNamespace(user=SimpleNamespace(id=USER_ID))

    @pytest.mark.asyncio
    async def test_tutor_auth_accepts_students_and_faculty_but_not_admins(monkeypatch):
        monkeypatch.setattr(
            auth_module,
            "_verify_and_load_profile",
            lambda token, settings: (USER_ID, "faculty", True),
        )
        faculty = await auth_module.authenticate_tutor_request("tutor-token", configured_settings())
        assert faculty.id == USER_ID
        assert faculty.role == "faculty"

        monkeypatch.setattr(
            auth_module,
            "_verify_and_load_profile",
            lambda token, settings: (USER_ID, "student", True),
        )
        student = await auth_module.authenticate_tutor_request("tutor-token", configured_settings())
        assert student.role == "student"

        monkeypatch.setattr(
            auth_module,
            "_verify_and_load_profile",
            lambda token, settings: (USER_ID, "admin", True),
        )
        with pytest.raises(ForbiddenError, match="student and faculty accounts only"):
            await auth_module.authenticate_tutor_request("tutor-token", configured_settings())


    class FakeQuery:
        def select(self, fields):
            assert fields == "role,is_approved"
            return self

        def eq(self, field, value):
            assert (field, value) == ("id", USER_ID)
            return self

        def maybe_single(self):
            return self

        def execute(self):
            return SimpleNamespace(data={"role": "student", "is_approved": True})

    class FakeClient:
        auth = FakeAuth()

        def table(self, name):
            assert name == "profiles"
            return FakeQuery()

    monkeypatch.setattr(
        auth_module,
        "create_user_supabase_client",
        lambda settings, token: FakeClient(),
    )
    monkeypatch.setattr(
        auth_module,
        "create_admin_supabase_client",
        lambda settings: FakeClient(),
    )

    user = await auth_module.authenticate_request("Bearer access-token", configured_settings())

    assert user.id == USER_ID
    assert user.role == "student"
    assert user.is_approved is True


@pytest.mark.asyncio
async def test_auth_rejects_unapproved_profile(monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "_verify_and_load_profile",
        lambda token, settings: (USER_ID, "student", False),
    )

    with pytest.raises(ForbiddenError, match="awaiting administrator approval"):
        await auth_module.authenticate_request("Bearer ******", configured_settings())


@pytest.mark.asyncio
async def test_auth_rejects_missing_bearer_and_unconfigured_supabase():
    with pytest.raises(auth_module.UnauthorizedError):
        await auth_module.authenticate_request(None, configured_settings())
    with pytest.raises(auth_module.UnauthorizedError):
        await auth_module.authenticate_request("Basic invalid", configured_settings())
    with pytest.raises(auth_module.ServiceUnavailableError, match="Supabase"):
        await auth_module.authenticate_request(
            "Bearer access-token",
            Settings(_env_file=None),
        )


@pytest.mark.asyncio
async def test_auth_rejects_non_student_role(monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "_verify_and_load_profile",
        lambda token, settings: (USER_ID, "faculty"),
    )
    with pytest.raises(ForbiddenError, match="student accounts only"):
        await auth_module.authenticate_request("Bearer access-token", configured_settings())


@pytest.mark.asyncio
async def test_faculty_auth_accepts_only_trusted_faculty_role(monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "_verify_and_load_profile",
        lambda token, settings: (USER_ID, "faculty"),
    )

    user = await auth_module.authenticate_faculty_request("Bearer access-token", configured_settings())
    assert user.id == USER_ID
    assert user.role == "faculty"

    monkeypatch.setattr(
        auth_module,
        "_verify_and_load_profile",
        lambda token, settings: (USER_ID, "student"),
    )
    with pytest.raises(ForbiddenError, match="faculty accounts only"):
        await auth_module.authenticate_faculty_request("Bearer access-token", configured_settings())


class FakeQuery:
    def __init__(self, data):
        self.data = data
        self.filters = {}
        self.ordering = None
        self.limit_value = None
        self.single = False

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def maybe_single(self):
        self.single = True
        return self

    def order(self, field, desc=False):
        self.ordering = (field, desc)
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def execute(self):
        if self.data is None:
            data = None
        elif isinstance(self.data, list):
            data = [
                row for row in self.data
                if all(row.get(field) == value for field, value in self.filters.items())
            ]
            if self.ordering and self.ordering[1]:
                data.reverse()
            if self.limit_value is not None:
                data = data[:self.limit_value]
        else:
            data = self.data
        if self.single and isinstance(data, list):
            data = data[0] if data else None
        return SimpleNamespace(data=data)


class FakeRPC:
    def __init__(self, response_id):
        self.response_id = response_id
        self.name = None
        self.parameters = None

    def execute(self):
        return SimpleNamespace(data=self.response_id)


class FakeSupabase:
    def __init__(self, owner_id):
        self.tables = {
            "conversations": [{"id": str(SESSION_ID), "owner_id": owner_id}],
            "messages": [
                {
                    "conversation_id": str(SESSION_ID),
                    "role": "user",
                    "content": "Question",
                },
                {
                    "conversation_id": str(SESSION_ID),
                    "role": "assistant",
                    "content": "Earlier answer",
                },
            ],
        }
        self.rpc_call = None

    def table(self, name):
        return FakeQuery(self.tables[name])

    def rpc(self, name, parameters):
        self.rpc_call = (name, parameters)
        return FakeRPC(str(ASSISTANT_MESSAGE_ID))


@pytest.mark.asyncio
async def test_conversation_store_scopes_history_and_persists_turns_atomically():
    client = FakeSupabase(USER_ID)
    store = SupabaseConversationStore(
        configured_settings(),
        "access-token",
        USER_ID,
        client=client,
    )

    history = await store.get_history(SESSION_ID, USER_ID, 10)
    assistant_id = await store.save_turn(
        SESSION_ID,
        "Question",
        "Answer",
        {"provider": "groq"},
    )

    assert history == [
        {"role": "user", "content": "Question"},
        {"role": "assistant", "content": "Earlier answer"},
    ]
    assert assistant_id == ASSISTANT_MESSAGE_ID
    assert client.rpc_call == (
        "append_conversation_turn",
        {
            "target_conversation_id": str(SESSION_ID),
            "user_content": "Question",
            "assistant_content": "Answer",
            "turn_metadata": {"provider": "groq"},
        },
    )


@pytest.mark.asyncio
async def test_conversation_store_does_not_disclose_foreign_or_missing_sessions():
    foreign_store = SupabaseConversationStore(
        configured_settings(),
        "access-token",
        USER_ID,
        client=FakeSupabase("other-student"),
    )
    with pytest.raises(ConversationNotFoundError):
        await foreign_store.get_history(SESSION_ID, USER_ID, 10)

    missing_store = SupabaseConversationStore(
        configured_settings(),
        "access-token",
        USER_ID,
        client=FakeSupabase(USER_ID),
    )
    with pytest.raises(ConversationNotFoundError):
        await missing_store.get_history(uuid4(), USER_ID, 10)
