import asyncio
import logging
import re
from typing import Any
from uuid import UUID

import httpx
from postgrest.exceptions import APIError

from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError
from ai_service.app.supabase_client import create_admin_supabase_client, create_user_supabase_client

AGENT_RECORD_TYPES = {
    "learning_profiles",
    "concept_mastery",
    "practice_assessments",
    "practice_submissions",
}

logger = logging.getLogger(__name__)


class SupabaseLearningRepository:
    def __init__(
        self,
        settings: Settings,
        access_token: str,
        user_id: str | UUID,
        client: Any = None,
    ) -> None:
        self._settings = settings
        self._access_token = access_token
        self._user_id = str(user_id)
        self._client = client

    def _supabase(self):
        return self._client or create_user_supabase_client(self._settings, self._access_token)

    def _admin_supabase(self):
        return self._client or create_admin_supabase_client(self._settings)

    @staticmethod
    def _run_query(query):
        try:
            response = query.execute()
            return response.data
        except APIError as error:
            code = getattr(error, "code", None)
            safe_code = (
                code
                if isinstance(code, str) and code.isascii() and code.isalnum() and len(code) <= 12
                else "unknown"
            )
            message = getattr(error, "message", "")
            missing_column = (
                re.search(r"column ([A-Za-z0-9_.]+) does not exist", message, re.IGNORECASE)
                if isinstance(message, str)
                else None
            )
            safe_detail = f"; missing column {missing_column.group(1)}" if missing_column else ""
            logger.warning(
                "Supabase learning data query failed with code %s%s",
                safe_code,
                safe_detail,
                extra={"supabase_error_code": safe_code},
            )
            if getattr(error, "code", None) == "42501":
                raise ForbiddenError("The authenticated account cannot access this learning data.") from error
            raise ServiceUnavailableError("The Supabase learning data request failed.") from error
        except httpx.HTTPError as error:
            raise ServiceUnavailableError("Supabase learning data is unavailable.") from error

    @staticmethod
    def _map_course(row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "subjectId": row.get("subject_id"),
            "facultyUid": row.get("instructor_id"),
            "instructorUid": row.get("instructor_id"),
        }

    @staticmethod
    def _map_enrollment(row: dict[str, Any]) -> dict[str, Any]:
        return {
            **row,
            "studentUid": row.get("student_id"),
            "courseId": row.get("course_id"),
            "subjectId": row.get("subject_id"),
            "enrolledAt": row.get("enrolled_at"),
        }

    @staticmethod
    def _map_record(collection_name: str, row: dict[str, Any]) -> dict[str, Any]:
        if collection_name == "student_progress":
            return {
                **row,
                "studentUid": row.get("student_id"),
                "courseId": row.get("course_id"),
                "topicId": row.get("topic_id"),
                "topicTitle": row.get("topic_title"),
                "masteryScore": row.get("mastery_score"),
                "totalAttempts": row.get("total_attempts"),
                "isCompleted": row.get("is_completed"),
                "lastStudiedAt": row.get("last_studied_at"),
            }
        if collection_name == "learning_activity":
            return {
                **row,
                "studentUid": row.get("student_id"),
                "courseId": row.get("course_id"),
                "activityType": row.get("activity_type"),
                "createdAt": row.get("created_at"),
            }
        if collection_name == "assessment_submissions":
            return {
                **row,
                "studentUid": row.get("student_id"),
                "courseId": row.get("course_id"),
                "submittedAt": row.get("submitted_at"),
                "maximumScore": row.get("total_questions"),
            }
        if collection_name == "verified_subject_marks":
            return {
                **row,
                "studentUid": row.get("student_id"),
                "courseId": row.get("course_id"),
                "subjectId": row.get("subject_id"),
                "score": row.get("marks"),
                "maximumScore": row.get("max_marks"),
                "verifiedByUid": row.get("verified_by"),
                "verifiedAt": row.get("verified_at"),
            }
        if collection_name == "semester_results":
            return {
                **row,
                "studentUid": row.get("student_id"),
                "verifiedByUid": row.get("verified_by"),
                "verifiedAt": row.get("verified_at"),
                "semesterNumber": row.get("semester_number"),
                "resultStatus": row.get("result_status"),
            }
        return row

    def _load_student_data(self, course_id: str | None = None) -> dict[str, Any]:
        # This trusted read is scoped to the already authenticated user and their enrollments.
        client = self._client or create_admin_supabase_client(self._settings)
        profile_data = self._run_query(
            client.table("profiles")
            .select(
                "id,email,role,is_approved,institution_id"
            )
            .eq("id", self._user_id)
            .maybe_single()
        )
        if (
            not isinstance(profile_data, dict)
            or profile_data.get("role") != "student"
            or profile_data.get("is_approved") is not True
        ):
            raise ForbiddenError("No approved student profile exists for this account.")
        profile = profile_data

        enrollment_rows = self._run_query(
            client.table("enrollments")
            .select("*")
            .eq("student_id", self._user_id)
            .limit(1000)
        )
        enrollments = [
            self._map_enrollment(row)
            for row in enrollment_rows or []
            if isinstance(row, dict)
            and str(row.get("status", "active")).lower() in {"active", "enrolled", "completed"}
        ]
        course_ids = list({str(row["course_id"]) for row in enrollments if row.get("course_id")})
        course_rows = []
        if course_ids:
            course_rows = self._run_query(
                client.table("courses")
                .select("*")
                .in_("id", course_ids)
                .limit(1000)
            ) or []
        courses = [
            self._map_course(row)
            for row in course_rows
            if isinstance(row, dict) and row.get("id") in course_ids
        ]
        valid_course_ids = {str(course["id"]) for course in courses}
        if course_id and course_id not in valid_course_ids:
            raise ForbiddenError("The authenticated student is not enrolled in this course.")
        selected_subject_ids = {
            course.get("subjectId")
            for course in courses
            if course_id and str(course["id"]) == course_id and course.get("subjectId")
        }

        table_names = {
            "student_progress": "student_progress",
            "learning_activity": "learning_activity",
            "assessment_submissions": "assessment_submissions",
            "verified_subject_marks": "verified_subject_marks",
            "semester_results": "semester_results",
        }
        own_records: dict[str, list[dict[str, Any]]] = {}
        for key, table in table_names.items():
            query = client.table(table).select("*").eq("student_id", self._user_id).limit(1000)
            rows = self._run_query(query) or []
            mapped = [
                self._map_record(key, row)
                for row in rows
                if isinstance(row, dict)
                and (
                    not row.get("course_id")
                    or str(row.get("course_id")) in valid_course_ids
                )
                and (
                    not course_id
                    or not row.get("course_id")
                    or str(row.get("course_id")) == course_id
                )
            ]
            if key in {"verified_subject_marks", "semester_results"}:
                mapped = [
                    row for row in mapped
                    if row.get("verifiedByUid") and row.get("verifiedAt") is not None
                ]
            if (
                course_id
                and key == "verified_subject_marks"
            ):
                mapped = [
                    row for row in mapped
                    if row.get("courseId") == course_id
                    or (not row.get("courseId") and row.get("subjectId") in selected_subject_ids)
                ]
            if course_id and key == "semester_results":
                mapped = []
            own_records[key] = mapped

        return {
            "profile": profile,
            "enrollments": [row for row in enrollments if row.get("courseId") in valid_course_ids],
            "courses": [row for row in courses if not course_id or str(row["id"]) == course_id],
            "progress": own_records["student_progress"],
            "activity": own_records["learning_activity"],
            "assessment_submissions": own_records["assessment_submissions"],
            "verified_marks": own_records["verified_subject_marks"],
            "semester_results": own_records["semester_results"],
        }

    async def get_student_data(self, course_id: str | None = None) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(self._load_student_data, course_id)
        except ForbiddenError:
            raise
        except ServiceUnavailableError:
            raise

    def _load_faculty_course(self, course_id: str) -> dict[str, Any]:
        response = self._run_query(
            self._supabase()
            .table("courses")
            .select("*")
            .eq("id", course_id)
            .maybe_single()
        )
        if not isinstance(response, dict) or str(response.get("instructor_id")) != self._user_id:
            raise ForbiddenError("The requested course is not assigned to this faculty account.")
        return self._map_course(response)

    async def get_faculty_course(self, course_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._load_faculty_course, course_id)

    def _load_course_materials(self, course_id: str) -> list[dict[str, Any]]:
        rows = self._run_query(
            self._supabase()
            .table("course_materials")
            .select("*")
            .eq("course_id", course_id)
            .eq("published", True)
            .eq("publication_status", "published")
            .limit(500)
        ) or []
        return [
            {
                **row,
                "courseId": row.get("course_id"),
                "publicationStatus": row.get("publication_status"),
                "documentId": row.get("document_id"),
                "ownerUid": row.get("owner_id"),
            }
            for row in rows
            if isinstance(row, dict)
            and row.get("published") is True
            and row.get("publication_status") == "published"
        ]

    async def get_course_materials(self, course_id: str) -> list[dict[str, Any]]:
        await self.get_student_data(course_id)
        return await asyncio.to_thread(self._load_course_materials, course_id)

    def _get_agent_record(self, collection_name: str, record_id: str) -> dict[str, Any] | None:
        if collection_name not in AGENT_RECORD_TYPES:
            raise ValueError("Unsupported learning record type.")
        row = self._run_query(
            self._supabase()
            .table("student_agent_records")
            .select("*")
            .eq("owner_id", self._user_id)
            .eq("record_type", collection_name)
            .eq("legacy_id", record_id)
            .maybe_single()
        )
        if not isinstance(row, dict):
            return None
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        return {
            **payload,
            "id": record_id,
            "ownerUid": row.get("owner_id"),
            "courseId": row.get("course_id"),
            "updatedAt": row.get("updated_at"),
        }

    async def get_agent_record(self, collection_name: str, record_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_agent_record, collection_name, record_id)

    def _list_agent_records(self, collection_name: str, limit: int) -> list[dict[str, Any]]:
        if collection_name not in AGENT_RECORD_TYPES:
            raise ValueError("Unsupported learning record type.")
        rows = self._run_query(
            self._supabase()
            .table("student_agent_records")
            .select("*")
            .eq("owner_id", self._user_id)
            .eq("record_type", collection_name)
            .order("updated_at", desc=True)
            .limit(limit)
        ) or []
        return [
            {
                **(row.get("payload") if isinstance(row.get("payload"), dict) else {}),
                "id": row.get("legacy_id"),
                "ownerUid": row.get("owner_id"),
                "courseId": row.get("course_id"),
                "updatedAt": row.get("updated_at"),
            }
            for row in rows
            if isinstance(row, dict)
        ]

    async def list_agent_records(self, collection_name: str, limit: int = 500) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._list_agent_records, collection_name, limit)

    def _save_agent_record(
        self,
        collection_name: str,
        record_id: str,
        data: dict[str, Any],
        merge: bool,
    ) -> None:
        if collection_name not in AGENT_RECORD_TYPES:
            raise ValueError("Unsupported learning record type.")
        if collection_name == "practice_assessments":
            if merge:
                raise ValueError("Practice assignments cannot be updated outside lifecycle transitions.")
            course_id = data.get("courseId")
            if not isinstance(course_id, str) or not course_id:
                raise ValueError("Practice assignments require an authorized course.")
            response = self._run_query(
                self._admin_supabase().rpc(
                    "create_practice_assessment",
                    {
                        "target_owner_id": self._user_id,
                        "target_assessment_id": record_id,
                        "target_course_id": course_id,
                        "assessment_payload": data,
                    },
                )
            )
            if not isinstance(response, dict):
                raise ServiceUnavailableError("Supabase returned an invalid generated assignment.")
            return
        client = self._supabase()
        payload = dict(data)
        if merge:
            current = self._get_agent_record(collection_name, record_id)
            if current:
                payload = {**current, **payload}
        course_id = payload.get("courseId")
        record = {
            "legacy_id": record_id,
            "owner_id": self._user_id,
            "course_id": str(course_id) if course_id else None,
            "record_type": collection_name,
            "payload": payload,
        }
        self._run_query(
            client.table("student_agent_records").upsert(
                record,
                on_conflict="owner_id,record_type,legacy_id",
            )
        )

    async def save_agent_record(
        self,
        collection_name: str,
        record_id: str | None,
        data: dict[str, Any],
        merge: bool = False,
    ) -> str:
        if not record_id:
            raise ValueError("Learning records require a stable record ID.")
        await asyncio.to_thread(self._save_agent_record, collection_name, record_id, data, merge)
        return record_id

    def _transition_practice_assessment_state(
        self,
        assessment_id: str,
        expected_statuses: list[str],
        next_status: str,
        payload_patch: dict[str, Any],
    ) -> dict[str, Any]:
        response = self._run_query(
            self._admin_supabase().rpc(
                "transition_practice_assessment_state",
                {
                    "target_owner_id": self._user_id,
                    "target_assessment_id": assessment_id,
                    "expected_statuses": expected_statuses,
                    "next_status": next_status,
                    "payload_patch": payload_patch,
                },
            )
        )
        if not isinstance(response, dict):
            raise ServiceUnavailableError("Supabase returned an invalid assignment state.")
        return response

    async def transition_practice_assessment_state(
        self,
        assessment_id: str,
        expected_statuses: list[str],
        next_status: str,
        payload_patch: dict[str, Any],
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._transition_practice_assessment_state,
            assessment_id,
            expected_statuses,
            next_status,
            payload_patch,
        )

    def _record_learning_activity(self, activity_type: str, course_id: str, assessment_id: str) -> None:
        self._run_query(
            self._supabase().rpc(
                "record_ai_learning_activity",
                {
                    "target_course_id": course_id,
                    "target_activity_type": activity_type,
                    "target_assessment_id": assessment_id,
                },
            )
        )

    async def record_learning_activity(
        self,
        activity_type: str,
        course_id: str,
        assessment_id: str,
    ) -> None:
        await self.get_student_data(course_id)
        await asyncio.to_thread(
            self._record_learning_activity,
            activity_type,
            course_id,
            assessment_id,
        )

    def _record_mastery_evidence(
        self,
        concept_id: str,
        concept_title: str,
        correct: bool,
        course_id: str,
        source_id: str,
    ) -> dict[str, Any]:
        response = self._run_query(
            self._supabase().rpc(
                "record_concept_mastery_evidence",
                {
                    "target_course_id": course_id,
                    "target_concept_id": concept_id,
                    "target_concept_title": concept_title,
                    "answer_correct": correct,
                    "target_source_id": source_id,
                },
            )
        )
        if not isinstance(response, dict):
            raise ServiceUnavailableError("Supabase returned an invalid concept mastery result.")
        return response

    async def record_mastery_evidence(
        self,
        concept_id: str,
        concept_title: str,
        correct: bool,
        course_id: str,
        source_id: str,
    ) -> dict[str, Any]:
        await self.get_student_data(course_id)
        return await asyncio.to_thread(
            self._record_mastery_evidence,
            concept_id,
            concept_title,
            correct,
            course_id,
            source_id,
        )
