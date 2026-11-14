import asyncio
from typing import Any
from uuid import UUID

import httpx
from postgrest.exceptions import APIError

from ai_service.app.config import Settings
from ai_service.app.errors import ConversationNotFoundError, ServiceUnavailableError
from ai_service.app.supabase_client import create_user_supabase_client


class SupabaseConversationStore:
    def __init__(
        self,
        settings: Settings,
        access_token: str,
        authenticated_user_id: str | UUID,
        client: Any = None,
    ) -> None:
        self._settings = settings
        self._access_token = access_token
        self._user_id = str(authenticated_user_id)
        self._client = client

    def _supabase(self):
        return self._client or create_user_supabase_client(self._settings, self._access_token)

    def _get_conversation(self, session_id: UUID) -> dict[str, Any]:
        response = (
            self._supabase()
            .table("conversations")
            .select("id, owner_id")
            .eq("id", str(session_id))
            .maybe_single()
            .execute()
        )
        conversation = response.data
        if not isinstance(conversation, dict):
            raise ConversationNotFoundError("Conversation was not found or is not accessible.")
        if conversation.get("owner_id") != self._user_id:
            raise ConversationNotFoundError("Conversation was not found or is not accessible.")
        return conversation

    def _get_history(self, session_id: UUID, limit: int) -> list[dict[str, str]]:
        self._get_conversation(session_id)
        response = (
            self._supabase()
            .table("messages")
            .select("role, content")
            .eq("conversation_id", str(session_id))
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = response.data if isinstance(response.data, list) else []
        rows.reverse()
        return [
            {"role": item["role"], "content": item["content"]}
            for item in rows
            if isinstance(item, dict)
            and item.get("role") in {"user", "assistant"}
            and isinstance(item.get("content"), str)
        ]

    async def get_history(self, session_id: UUID, user_id: str | UUID, limit: int) -> list[dict[str, str]]:
        if str(user_id) != self._user_id:
            raise ConversationNotFoundError("Conversation was not found or is not accessible.")
        try:
            return await asyncio.to_thread(self._get_history, session_id, limit)
        except ConversationNotFoundError:
            raise
        except (APIError, httpx.RequestError) as error:
            raise ServiceUnavailableError("Supabase conversation history is unavailable.") from error

    def _save_turn(
        self,
        session_id: UUID,
        user_content: str,
        assistant_content: str,
        metadata: dict[str, Any],
    ) -> UUID:
        self._get_conversation(session_id)
        response = (
            self._supabase()
            .rpc(
                "append_conversation_turn",
                {
                    "target_conversation_id": str(session_id),
                    "user_content": user_content,
                    "assistant_content": assistant_content,
                    "turn_metadata": metadata,
                },
            )
            .execute()
        )
        return UUID(str(response.data))

    async def save_turn(
        self,
        session_id: UUID,
        user_content: str,
        assistant_content: str,
        metadata: dict[str, Any],
    ) -> UUID:
        try:
            return await asyncio.to_thread(
                self._save_turn,
                session_id,
                user_content,
                assistant_content,
                metadata,
            )
        except ConversationNotFoundError:
            raise
        except (APIError, httpx.RequestError, TypeError, ValueError) as error:
            raise ServiceUnavailableError(
                "The generated response could not be persisted to Supabase."
            ) from error
