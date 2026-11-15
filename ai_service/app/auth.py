import asyncio
import logging
from dataclasses import dataclass

import httpx
from fastapi import Header
from postgrest.exceptions import APIError
from supabase_auth.errors import AuthError

from ai_service.app.config import Settings, get_settings
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from ai_service.app.supabase_client import create_admin_supabase_client, create_user_supabase_client

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    role: str
    is_approved: bool = True


def _normalize_role(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    role = value.strip().lower()
    if role == "instructor":
        return "faculty"
    return role if role in {"student", "faculty", "admin"} else None


def _verify_and_load_profile(token: str, settings: Settings) -> tuple[str, str, bool]:
    try:
        client = create_user_supabase_client(settings, token)
        auth_response = client.auth.get_user(token)
        user = auth_response.user
        if user is None or not isinstance(user.id, str) or not user.id:
            raise UnauthorizedError("The Supabase access token is invalid.")

        profile_response = (
            create_admin_supabase_client(settings)
            .table("profiles")
            .select("role,is_approved")
            .eq("id", user.id)
            .maybe_single()
            .execute()
        )
        profile = profile_response.data
        role = _normalize_role(profile.get("role") if isinstance(profile, dict) else None)
        if role is None:
            raise ForbiddenError("No trusted application profile exists for this account.")
        is_approved_value = profile.get("is_approved") if isinstance(profile, dict) else None
        if not isinstance(is_approved_value, bool):
            raise ServiceUnavailableError("The trusted profile approval status is unavailable.")
        is_approved = is_approved_value
        return user.id, role, is_approved
    except (UnauthorizedError, ForbiddenError):
        raise
    except AuthError as error:
        if getattr(error, "status", None) in {400, 401, 403}:
            raise UnauthorizedError("The Supabase access token is invalid or expired.") from error
        logger.warning(
            "Supabase authentication request failed",
            extra={"supabase_error": type(error).__name__, "status": getattr(error, "status", None)},
        )
        raise ServiceUnavailableError("Supabase authentication is unavailable.") from error
    except APIError as error:
        code = getattr(error, "code", None)
        status = getattr(error, "status_code", None)
        if code in {"PGRST116", "42501"} or status == 403:
            raise ForbiddenError("The authenticated account does not have an accessible application profile.") from error
        logger.warning(
            "Supabase profile lookup failed",
            extra={"supabase_error_code": code, "status": status},
        )
        raise ServiceUnavailableError("Supabase profile lookup is unavailable.") from error
    except httpx.RequestError as error:
        logger.warning("Supabase authentication service is unreachable", extra={"supabase_error": type(error).__name__})
        raise ServiceUnavailableError("Supabase authentication is unavailable.") from error


async def _authenticate_role(
    authorization: str | None = Header(default=None),
    settings: Settings | None = None,
    required_role: str | tuple[str, ...] = "student",
) -> AuthenticatedUser:
    config = settings or get_settings()
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError("A valid Supabase access token is required.")

    token = authorization.removeprefix("Bearer ").strip()
    if not token or len(token) > 8192:
        raise UnauthorizedError("The supplied Supabase access token is invalid.")
    if not config.supabase_is_configured:
        raise ServiceUnavailableError("AI service Supabase authentication is not configured.")

    authenticated_profile = await asyncio.to_thread(_verify_and_load_profile, token, config)
    if len(authenticated_profile) == 2:
        user_id, role = authenticated_profile
        is_approved = True
    else:
        user_id, role, is_approved = authenticated_profile
    if not is_approved:
        raise ForbiddenError("This account is awaiting administrator approval.")
    required_roles = (required_role,) if isinstance(required_role, str) else required_role
    if role not in required_roles:
        if "student" in required_roles and "faculty" in required_roles:
            message = "The AI tutor is available to student and faculty accounts only."
        elif "student" in required_roles:
            message = "The AI tutor is available to student accounts only."
        else:
            message = "AI assessment generation is available to faculty accounts only."
        raise ForbiddenError(message)
    return AuthenticatedUser(id=user_id, role=role, is_approved=is_approved)


async def authenticate_request(
    authorization: str | None = Header(default=None),
    settings: Settings | None = None,
) -> AuthenticatedUser:
    return await _authenticate_role(authorization, settings, "student")


async def authenticate_faculty_request(
    authorization: str | None = Header(default=None),
    settings: Settings | None = None,
) -> AuthenticatedUser:
    return await _authenticate_role(authorization, settings, "faculty")


async def authenticate_tutor_request(
    authorization: str | None = Header(default=None),
    settings: Settings | None = None,
) -> AuthenticatedUser:
    return await _authenticate_role(authorization, settings, ("student", "faculty"))
