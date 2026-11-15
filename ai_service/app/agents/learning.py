import json
import logging
import re
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, ProviderError, ServiceUnavailableError
from ai_service.app.learning_repository import SupabaseLearningRepository
from ai_service.app.providers.base import LLMProvider


def _concept_id(value: object) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value).strip().lower()).strip("-")
    return cleaned[:120]


def _is_published_practice_assessment(record: dict[str, Any]) -> bool:
    result = record.get("result")
    questions = result.get("questionResults") if isinstance(result, dict) else None
    return (
        record.get("status") == "RESULTS_PUBLISHED"
        and isinstance(questions, list)
        and bool(questions)
        and len(questions) == result.get("totalQuestions")
        and all(isinstance(item, dict) and isinstance(item.get("isCorrect"), bool) for item in questions)
    )


class GeneratedQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1200)
    topic: str = Field(min_length=1, max_length=160)
    options: list[str] = Field(default_factory=list, max_length=6)
    answer_index: int | None = Field(default=None, ge=0, le=5)
    reference_answer: str | None = Field(default=None, max_length=2000)
    rubric: list[str] = Field(default_factory=list, max_length=8)
    explanation: str = Field(default="", max_length=1200)

    @model_validator(mode="after")
    def validate_format(self):
        if self.options:
            if not 2 <= len(self.options) <= 6 or self.answer_index is None:
                raise ValueError("Multiple-choice questions require 2 to 6 options and an answer index.")
            if self.answer_index >= len(self.options):
                raise ValueError("The correct option index is outside the options list.")
        elif not self.reference_answer or not self.rubric:
            raise ValueError("Descriptive questions require a reference answer and a grading rubric.")
        return self


class GeneratedAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=160)
    questions: list[GeneratedQuestion] = Field(min_length=1, max_length=10)


class FacultyDraftQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    question_text: str = Field(alias="questionText", min_length=1, max_length=1200)
    topic_tag: str = Field(alias="topicTag", min_length=1, max_length=160)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_option_index: int = Field(alias="correctOptionIndex", ge=0, le=5)
    explanation: str = Field(min_length=1, max_length=1200)

    @field_validator("question_text", "topic_tag", "explanation")
    @classmethod
    def nonblank_values(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Question text, topic tag, and explanation cannot be blank.")
        return cleaned

    @field_validator("options")
    @classmethod
    def valid_options(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("Question options cannot be blank.")
        if len({value.casefold() for value in cleaned}) != len(cleaned):
            raise ValueError("Question options must be distinct.")
        return cleaned

    @model_validator(mode="after")
    def validate_answer(self):
        if self.correct_option_index >= len(self.options):
            raise ValueError("The correct option index is outside the options list.")
        return self


class FacultyDraftAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    questions: list[FacultyDraftQuestion] = Field(min_length=1, max_length=10)


class StudentModelingAgent:
    name = "student_modeling"

    def __init__(self, repository: SupabaseLearningRepository) -> None:
        self._repository = repository

    async def build_profile(self, course_id: str | None = None) -> dict[str, Any]:
        data = await self._repository.get_student_data(course_id)
        profile = data["profile"]
        explicit_preferences = profile.get("learningPreferences")
        preferences = (
            [value.strip() for value in explicit_preferences if isinstance(value, str) and value.strip()]
            if isinstance(explicit_preferences, list)
            else []
        )
        result = {
            "profileVersion": 1,
            "enrolledCourses": [
                {"courseId": course["id"], "courseCode": course.get("code", ""), "title": course.get("title", "")}
                for course in data["courses"]
            ],
            "learningActivityCount": len(data["activity"]),
            "serverGradedAssessmentCount": len(data["assessment_submissions"]),
            "verifiedAcademicRecordCount": len(data["verified_marks"]) + len(data["semester_results"]),
            "learningPreferences": preferences,
            "preferenceEvidence": "explicitly provided" if preferences else "not provided",
            "dataSources": [
                "Supabase profiles",
                "Supabase enrollments and courses",
                "Supabase learning_activity",
                "Supabase assessment_submissions",
                "Supabase verified_subject_marks and semester_results",
            ],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        await self._repository.save_agent_record("learning_profiles", "current", result, merge=True)
        return result


class KnowledgeTracingAgent:
    name = "knowledge_tracing"

    def __init__(self, repository: SupabaseLearningRepository) -> None:
        self._repository = repository

    async def update_from_responses(
        self,
        course_id: str,
        assessment_id: str,
        responses: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        updated = []
        for response in responses:
            concept_title = str(response["topic"]).strip()
            concept_id = str(response["concept_id"])
            updated.append(await self._repository.record_mastery_evidence(
                concept_id=concept_id,
                concept_title=concept_title,
                correct=bool(response["mastered"]),
                course_id=course_id,
                source_id=assessment_id,
            ))
        return updated

    async def estimate(self, course_id: str | None = None) -> dict[str, Any]:
        records = await self._repository.list_agent_records("concept_mastery")
        concepts = [
            record for record in records
            if not course_id or record.get("courseId") == course_id
        ]
        return {
            "method": "Beta(2, 2) prior; one Bernoulli evidence per graded practice response",
            "concepts": [
                {
                    "conceptId": item["conceptId"],
                    "concept": item["conceptTitle"],
                    "courseId": item["courseId"],
                    "mastery": float(item["masteryScore"]),
                    "evidenceCount": int(item["evidenceCount"]),
                    "estimated": True,
                    "status": "needs_revision" if float(item["masteryScore"]) < 60 else "developing",
                }
                for item in concepts
            ],
            "evidenceSource": "AI-generated practice assessment responses",
        }


class LearningAnalyticsAgent:
    name = "learning_analytics"

    def __init__(
        self,
        repository: SupabaseLearningRepository,
        knowledge_tracing: KnowledgeTracingAgent,
    ) -> None:
        self._repository = repository
        self._knowledge_tracing = knowledge_tracing

    async def analyze(self, course_id: str | None = None) -> dict[str, Any]:
        data = await self._repository.get_student_data(course_id)
        authorized_course_ids = {str(course["id"]) for course in data["courses"] if course.get("id")}
        practice_submissions = []
        for item in await self._repository.list_agent_records("practice_assessments", 1000):
            if (
                _is_published_practice_assessment(item)
                and str(item.get("courseId") or "") in authorized_course_ids
            ):
                practice_submissions.append(item)
        practice_scores = [
            float(item["result"]["percentage"])
            for item in practice_submissions
            if isinstance(item.get("result", {}).get("percentage"), (int, float))
        ]
        mastery = await self._knowledge_tracing.estimate(course_id)
        progress = [
            item for item in data["progress"]
            if not course_id or item.get("courseId") == course_id
        ]
        official_marks = [
            {
                "subjectId": item.get("subjectId"),
                "courseId": item.get("courseId"),
                "score": item.get("score"),
                "maximumScore": item.get("maximumScore"),
                "examinationType": item.get("examinationType"),
                "verifiedAt": item.get("verifiedAt"),
                "source": "verified_subject_marks",
            }
            for item in data["verified_marks"]
        ]
        official_marks = [
            item for item in official_marks
            if isinstance(item["score"], (int, float))
            and isinstance(item["maximumScore"], (int, float))
            and item["maximumScore"] > 0
        ]
        result = {
            "courseId": course_id,
            "learningActivityCount": len(data["activity"]),
            "reportedProgress": [
                {
                    "topic": item.get("topicTitle", item.get("topicId", "")),
                    "completed": bool(item.get("isCompleted", False)),
                    "mastery": item.get("masteryScore"),
                    "source": "student_progress",
                    "estimated": True,
                }
                for item in progress
            ],
            "aiPractice": {
                "attemptCount": len(practice_submissions),
                "averageScore": round(sum(practice_scores) / len(practice_scores), 1) if practice_scores else None,
                "scores": practice_scores,
                "source": "AI-generated practice assessments",
            },
            "verifiedAcademicMarks": official_marks,
            "estimatedConceptMastery": mastery["concepts"],
            "evidenceNotes": [
                "Verified academic marks are reported separately from practice scores.",
                "Concept mastery is an estimate based only on graded AI-generated practice responses.",
                "Student progress records are not presented as official academic marks.",
            ],
        }
        return result


class KnowledgeGraphAgent:
    name = "knowledge_graph"

    def __init__(self, repository: SupabaseLearningRepository) -> None:
        self._repository = repository

    async def build(self, course_id: str) -> dict[str, Any]:
        data = await self._repository.get_student_data(course_id)
        if not data["courses"]:
            raise ForbiddenError("The authenticated student is not enrolled in this course.")
        course = data["courses"][0]
        topic_rows = course.get("topics")
        if not isinstance(topic_rows, list):
            topic_rows = course.get("units")
        concepts: dict[str, dict[str, Any]] = {}
        raw_prerequisites: list[tuple[str, object]] = []
        if isinstance(topic_rows, list):
            for row in topic_rows:
                if not isinstance(row, dict):
                    continue
                title = row.get("title") or row.get("name")
                if not isinstance(title, str) or not title.strip():
                    continue
                identifier = _concept_id(row.get("id") or title)
                if not identifier:
                    continue
                concepts[identifier] = {
                    "id": identifier,
                    "title": title.strip()[:160],
                    "source": "enrolled course record",
                }
                raw_prerequisites.append((identifier, row.get("prerequisites", [])))

        edges = []
        for concept_id, prerequisites in raw_prerequisites:
            if isinstance(prerequisites, str):
                prerequisites = [prerequisites]
            if not isinstance(prerequisites, list):
                continue
            for prerequisite in prerequisites:
                prerequisite_id = _concept_id(prerequisite)
                if prerequisite_id in concepts:
                    edges.append({
                        "from": prerequisite_id,
                        "to": concept_id,
                        "relation": "prerequisite",
                        "source": "explicit prerequisite field in enrolled course record",
                    })
        return {
            "courseId": course_id,
            "courseTitle": course.get("title", ""),
            "concepts": list(concepts.values()),
            "relationships": edges,
            "source": "enrolled course record",
            "limitations": [
                "Only concepts and prerequisite relationships explicitly present in the course record are included.",
                "No syllabus relationship is inferred when source data is absent.",
            ],
        }


class RecommendationAgent:
    name = "recommendation"

    def __init__(
        self,
        repository: SupabaseLearningRepository,
        knowledge_graph: KnowledgeGraphAgent,
    ) -> None:
        self._repository = repository
        self._knowledge_graph = knowledge_graph

    async def recommend(self, course_id: str | None = None) -> dict[str, Any]:
        mastery = await self._repository.list_agent_records("concept_mastery")
        if course_id:
            graphs = [await self._knowledge_graph.build(course_id)]
        else:
            data = await self._repository.get_student_data()
            graphs = [
                await self._knowledge_graph.build(course["id"])
                for course in data["courses"]
            ]
        concepts = {
            node["id"]: {**node, "courseId": graph["courseId"]}
            for graph in graphs
            for node in graph["concepts"]
        }
        items = []
        for record in mastery:
            concept = concepts.get(record.get("conceptId"))
            if not concept or float(record.get("masteryScore", 100)) >= 60:
                continue
            materials = await self._repository.get_course_materials(concept["courseId"])
            matching_materials = [
                {"id": material["id"], "title": material.get("title", "Published course material")}
                for material in materials
                if concept["title"].casefold() in str(material.get("title", "")).casefold()
            ]
            items.append({
                "type": "revision",
                "courseId": concept["courseId"],
                "topicId": concept["id"],
                "topic": concept["title"],
                "masteryEstimate": float(record["masteryScore"]),
                "reason": "Recent graded practice responses indicate this concept needs revision.",
                "materials": matching_materials,
                "practiceAction": "Generate a new AI practice assessment for this topic.",
                "evidence": {
                    "source": "AI-generated practice assessment responses",
                    "responseCount": int(record.get("evidenceCount", 0)),
                },
            })
        items.sort(key=lambda item: (item["masteryEstimate"], item["topic"]))
        return {
            "courseId": course_id,
            "recommendations": items,
            "dataSource": "authorized enrollment, concept mastery estimates, and published course materials",
            "note": "No recommendation is generated for topics without supporting course and learning evidence.",
        }


class ExplainabilityAgent:
    name = "explainability"

    @staticmethod
    async def explain(output: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "summary": "This result is based on the listed student-owned records and course sources.",
            "evidence": evidence,
            "provenance": {
                "verified": "Official verified academic data is labeled with its Supabase table.",
                "calculated": "Practice score and mastery metrics are computed from recorded assessment responses.",
                "estimated": "Mastery, where shown, is an estimate and not an official university result.",
                "modelGenerated": "Generated questions and feedback are AI-generated practice, not official examination content.",
            },
            "uncertainty": "Missing or unsupported source data is not inferred.",
            "chainOfThought": "Private reasoning traces are not exposed.",
            "outputKeys": sorted(output.keys()),
        }


class AssessmentAgent:
    name = "assessment"

    def __init__(
        self,
        provider: LLMProvider | None,
        settings: Settings,
        repository: SupabaseLearningRepository,
        knowledge_tracing: KnowledgeTracingAgent,
    ) -> None:
        self._provider = provider
        self._settings = settings
        self._repository = repository
        self._knowledge_tracing = knowledge_tracing

    async def _generate_json(
        self,
        prompt: str,
        max_tokens: int = 1800,
        faculty_draft: bool = False,
    ) -> str:
        from asyncio import wait_for

        if self._provider is None:
            raise ProviderError("Groq is not configured for AI assessment generation.")
        try:
            generated = await wait_for(
                self._provider.generate(
                    [
                        {
                            "role": "system",
                            "content": (
                                (
                                    "Create draft questions for faculty review. Never claim generated questions "
                                    "are official university examination material. "
                                )
                                if faculty_draft
                                else "Create educational practice material, never official university exam questions. "
                            ) + (
                                "Return only valid JSON matching the requested schema. Do not include markdown."
                            ),
                        },
                        {"role": "user", "content": prompt},
                    ],
                    min(max_tokens, self._settings.max_output_tokens),
                ),
                timeout=self._settings.provider_timeout_seconds,
            )
        except TimeoutError as error:
            raise ServiceUnavailableError("The Groq assessment request timed out.") from error
        return generated.text

    async def generate_faculty_draft(
        self,
        course: dict[str, Any],
        topic: str,
        difficulty: str,
        question_count: int,
        bloom_level: str,
    ) -> dict[str, Any]:
        if self._provider is None:
            raise ServiceUnavailableError("Groq is not configured for faculty assessment generation.")
        schema = (
            '{"title":"...","questions":[{"questionText":"...","topicTag":"...",'
            '"options":["...","..."],"correctOptionIndex":0,"explanation":"..."}]}'
        )
        prompt = json.dumps({
            "task": "Generate an unpublished multiple-choice assessment draft for faculty review.",
            "course": {
                "code": str(course.get("code", ""))[:80],
                "title": str(course.get("title", ""))[:160],
            },
            "topic": topic,
            "difficulty": difficulty,
            "bloom_level": bloom_level,
            "question_count": question_count,
            "required_json_schema": schema,
            "constraints": [
                "Return exactly the requested number of questions.",
                "Each question must have 2 to 6 distinct options and exactly one correct option index.",
                "Use the supplied course and topic; do not invent course facts or citations.",
                "Explain why the correct option is right.",
                "This is an unpublished AI draft and requires faculty review before publication.",
            ],
        })
        try:
            assessment = FacultyDraftAssessment.model_validate_json(
                await self._generate_json(prompt, faculty_draft=True)
            )
        except (ValidationError, ValueError) as error:
            raise ProviderError("Groq returned an invalid faculty assessment draft.") from error
        if len(assessment.questions) != question_count:
            raise ProviderError("Groq returned an unexpected number of assessment questions.")

        course_code = str(course.get("code", ""))[:80]
        course_id = str(course.get("id", ""))
        return {
            "id": str(uuid4()),
            "courseId": course_id,
            "courseCode": course_code,
            "title": assessment.title,
            "topic": topic,
            "difficulty": difficulty,
            "durationMinutes": min(600, max(5, question_count * 5)),
            "passingScore": 70,
            "questions": [
                {
                    "id": str(uuid4()),
                    **question.model_dump(by_alias=True),
                }
                for question in assessment.questions
            ],
            "status": "draft",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    async def generate(
        self,
        course_id: str,
        topic: str | None,
        difficulty: str,
        learning_objectives: list[str],
        question_count: int,
        question_format: Literal["mcq", "descriptive"],
        topics: list[str] | None = None,
    ) -> dict[str, Any]:
        student_data = await self._repository.get_student_data(course_id)
        course = next(
            (item for item in student_data["courses"] if str(item.get("id")) == course_id),
            None,
        )
        if not course:
            raise ForbiddenError("The authenticated student is not enrolled in this course.")
        available_topics = course.get("topics")
        if not isinstance(available_topics, list):
            available_topics = course.get("units")
        course_topics = [
            str(item.get("title") or item.get("name")).strip()
            for item in available_topics or []
            if isinstance(item, dict) and (item.get("title") or item.get("name"))
        ]
        course_topics.extend(
            str(item).strip()
            for item in available_topics or []
            if isinstance(item, str) and item.strip()
        )
        selected_topics = [
            value.strip()
            for value in (topics or [])
            if isinstance(value, str) and value.strip()
        ]
        if not selected_topics and topic and topic.strip():
            selected_topics = [topic.strip()]
        if course_topics and selected_topics:
            available_by_name = {value.casefold() for value in course_topics}
            if any(value.casefold() not in available_by_name for value in selected_topics):
                raise ValueError("Choose topics listed for the selected subject.")
        topic_context = selected_topics or course_topics
        generation_scope = ", ".join(topic_context) if topic_context else str(
            course.get("title") or course.get("code") or "the selected subject"
        )
        if self._provider is None:
            raise ProviderError("Groq is not configured for AI practice assessment generation.")
        schema = (
            '{"title":"...","questions":[{"question":"...","topic":"...","options":["..."],'
            '"answer_index":0,"explanation":"..."}]}'
            if question_format == "mcq"
            else '{"title":"...","questions":[{"question":"...","topic":"...","reference_answer":"...",'
            '"rubric":["..."],"explanation":"..."}]}'
        )
        prompt = json.dumps({
            "task": "Generate a student practice assessment.",
            "course": {
                "id": course_id,
                "code": str(course.get("code", ""))[:80],
                "title": str(course.get("title", ""))[:160],
                "available_topics": course_topics[:50],
            },
            "topics": topic_context,
            "topic": generation_scope,
            "topic_selection_is_empty": not selected_topics,
            "difficulty": difficulty,
            "learning_objectives": learning_objectives,
            "question_count": question_count,
            "format": question_format,
            "required_json_schema": schema,
            "constraints": [
                "Do not claim that questions are official or from a university examination.",
                "Use only the supplied topic and learning objectives.",
                "For MCQs, provide 2 to 6 distinct options and exactly one answer index.",
                "For descriptive items, provide a reference answer and objective scoring rubric.",
            ],
        })
        try:
            assessment = GeneratedAssessment.model_validate_json(
                await self._generate_json(prompt)
            )
        except (ValidationError, ValueError) as error:
            raise ProviderError("Groq returned an invalid practice assessment structure.") from error
        if len(assessment.questions) != question_count:
            raise ProviderError("Groq returned an unexpected number of practice questions.")
        if question_format == "mcq" and any(not question.options for question in assessment.questions):
            raise ProviderError("Groq returned a descriptive item for a multiple-choice assessment.")
        if question_format == "descriptive" and any(question.options for question in assessment.questions):
            raise ProviderError("Groq returned a multiple-choice item for a descriptive assessment.")

        assessment_id = str(uuid4())
        questions = []
        public_questions = []
        for question in assessment.questions:
            question_id = str(uuid4())
            internal = {
                "id": question_id,
                **question.model_dump(),
                "format": question_format,
            }
            questions.append(internal)
            public_questions.append({
                "id": question_id,
                "question": question.question,
                "topic": question.topic,
                "format": question_format,
                "options": question.options if question_format == "mcq" else [],
            })
        record = {
            "courseId": course_id,
            "courseCode": str(course.get("code") or ""),
            "subject": str(course.get("title") or course.get("code") or ""),
            "aiGenerated": True,
            "assessmentType": "practice",
            "title": assessment.title,
            "topic": generation_scope,
            "selectedTopics": selected_topics,
            "topics": list(dict.fromkeys(question["topic"] for question in questions)),
            "difficulty": difficulty,
            "format": question_format,
            "questions": questions,
            "createdAt": datetime.now(timezone.utc),
            "status": "GENERATED",
            "learningAnalysisStatus": None,
        }
        await self._repository.save_agent_record("practice_assessments", assessment_id, record)
        return {
            "assessmentId": assessment_id,
            "courseId": course_id,
            "title": assessment.title,
            "topic": generation_scope,
            "topics": record["topics"],
            "subject": str(course.get("title") or course.get("code") or ""),
            "difficulty": difficulty,
            "format": question_format,
            "aiGenerated": True,
            "official": False,
            "questions": public_questions,
        }

    async def start(self, assessment_id: str) -> dict[str, Any]:
        assessment = await self._repository.get_agent_record("practice_assessments", assessment_id)
        if not assessment or assessment.get("aiGenerated") is not True:
            raise LookupError("AI practice assessment was not found or is not accessible.")
        course_id = assessment.get("courseId")
        if not isinstance(course_id, str):
            raise ProviderError("The stored practice assessment has invalid course metadata.")
        await self._repository.get_student_data(course_id)
        status = assessment.get("status", "GENERATED")
        if status == "GENERATED":
            return await self._repository.transition_practice_assessment_state(
                assessment_id,
                ["GENERATED"],
                "IN_PROGRESS",
                {"startedAt": datetime.now(timezone.utc).isoformat()},
            )
        if status in {"IN_PROGRESS", "SUBMITTED", "GRADED", "RESULTS_PUBLISHED"}:
            return assessment
        raise ValueError("This practice assignment cannot be started in its current state.")

    async def evaluate(
        self,
        assessment_id: str,
        answers: dict[str, int | str],
        time_spent_seconds: int = 0,
    ) -> dict[str, Any]:
        assessment = await self._repository.get_agent_record("practice_assessments", assessment_id)
        if not assessment or assessment.get("aiGenerated") is not True:
            raise LookupError("AI practice assessment was not found or is not accessible.")
        course_id = assessment.get("courseId")
        if not isinstance(course_id, str):
            raise ProviderError("The stored practice assessment has invalid course metadata.")
        await self._repository.get_student_data(course_id)
        questions = assessment.get("questions")
        if not isinstance(questions, list) or not questions:
            raise ProviderError("The stored practice assessment has no questions.")
        question_ids = {question.get("id") for question in questions if isinstance(question, dict)}
        if set(answers) - question_ids:
            raise ValueError("The submission contains an answer for an unknown question.")

        for question in questions:
            question_id = question["id"]
            if question_id not in answers:
                continue
            answer = answers[question_id]
            if question.get("format") == "mcq":
                options = question.get("options")
                if (
                    type(answer) is not int
                    or not isinstance(options, list)
                    or answer < 0
                    or answer >= len(options)
                ):
                    raise ValueError("A multiple-choice answer is outside the available options.")
            elif not isinstance(answer, str) or not answer.strip() or len(answer) > 4000:
                raise ValueError("A descriptive answer must be text of at most 4000 characters.")

        status = assessment.get("status", "GENERATED")
        if status == "RESULTS_PUBLISHED":
            if assessment.get("submittedAnswers") != answers:
                raise ValueError("This assignment has already been submitted with different answers.")
            saved_result = assessment.get("result")
            if isinstance(saved_result, dict):
                return {
                    **saved_result,
                    "status": status,
                    "learningAnalysisStatus": assessment.get("learningAnalysisStatus"),
                }
            raise ProviderError("The published practice assignment has no saved result.")
        if status == "GENERATED":
            raise ValueError("Start this assignment before submitting it.")
        if set(answers) != question_ids:
            if status == "IN_PROGRESS":
                await self._repository.transition_practice_assessment_state(
                    assessment_id,
                    ["IN_PROGRESS"],
                    "IN_PROGRESS",
                    {
                        "draftAnswers": answers,
                        "unansweredQuestionIds": sorted(question_ids - set(answers)),
                    },
                )
            raise ValueError("Answer every question before submitting this assignment.")
        if status == "IN_PROGRESS":
            assessment = await self._repository.transition_practice_assessment_state(
                assessment_id,
                ["IN_PROGRESS"],
                "SUBMITTED",
                {
                    "submittedAnswers": answers,
                    "submittedAt": datetime.now(timezone.utc).isoformat(),
                    "timeSpentSeconds": max(0, min(time_spent_seconds, 86400)),
                },
            )
            if assessment.get("submittedAnswers") != answers:
                raise ValueError("This assignment has already been submitted with different answers.")
            status = assessment.get("status")
        elif status == "SUBMITTED":
            if assessment.get("submittedAnswers") != answers:
                raise ValueError("This assignment has already been submitted with different answers.")
        elif status == "GRADED":
            if assessment.get("submittedAnswers") != answers:
                raise ValueError("This assignment has already been submitted with different answers.")
            saved_result = assessment.get("result")
            if not isinstance(saved_result, dict):
                raise ProviderError("The graded practice assignment has no saved result.")
        else:
            raise ValueError("This practice assignment cannot be submitted in its current state.")

        if status == "GRADED":
            result = assessment["result"]
        else:
            answers = assessment["submittedAnswers"]

            descriptive = [
                question for question in questions
                if question.get("format") == "descriptive"
            ]
            descriptive_results: dict[str, dict[str, Any]] = {}
            if descriptive:
                if self._provider is None:
                    raise ProviderError("Groq is not configured for descriptive assessment evaluation.")
                evaluation_prompt = json.dumps({
                    "task": "Grade the student's practice responses against the supplied rubrics.",
                    "items": [
                        {
                            "id": question["id"],
                            "prompt": question["question"],
                            "reference_answer": question["reference_answer"],
                            "rubric": question["rubric"],
                            "student_answer": str(answers[question["id"]])[:4000],
                        }
                        for question in descriptive
                    ],
                    "output_schema": {
                        "evaluations": [{
                            "id": "question id",
                            "score": "integer from 0 to 100",
                            "feedback": "brief constructive feedback",
                        }],
                    },
                    "do_not": ["return private chain of thought", "invent facts", "claim an official grade"],
                })
                try:
                    raw = await self._generate_json(evaluation_prompt, 1200)
                    parsed = json.loads(raw)
                    entries = parsed["evaluations"]
                    if not isinstance(entries, list):
                        raise ValueError("Evaluations must be a list.")
                    for item in entries:
                        if (
                            isinstance(item, dict)
                            and item.get("id") in {question["id"] for question in descriptive}
                            and isinstance(item.get("score"), int)
                            and 0 <= item["score"] <= 100
                            and isinstance(item.get("feedback"), str)
                        ):
                            descriptive_results[item["id"]] = {
                                "score": item["score"],
                                "feedback": item["feedback"][:1000],
                            }
                except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
                    raise ProviderError("Groq returned invalid descriptive assessment feedback.") from error
                if len(descriptive_results) != len(descriptive):
                    raise ProviderError("Groq did not evaluate every descriptive practice response.")

            results = []
            total_score = 0.0
            for question in questions:
                question_id = question["id"]
                answer = answers[question_id]
                if question.get("format") == "mcq":
                    correct_option = question["answer_index"]
                    is_correct = answer == correct_option
                    score = 100.0 if is_correct else 0.0
                    feedback = question.get("explanation", "")[:1000]
                    correct_answer = question["options"][correct_option]
                    selected_answer = question["options"][answer]
                else:
                    evaluation = descriptive_results[question_id]
                    score = float(evaluation["score"])
                    is_correct = score >= 70
                    feedback = evaluation["feedback"]
                    correct_option = None
                    correct_answer = question["reference_answer"]
                    selected_answer = answer
                total_score += score
                results.append({
                    "questionId": question_id,
                    "questionText": question["question"],
                    "topic": question["topic"],
                    "selectedAnswer": selected_answer,
                    "correctAnswer": correct_answer,
                    "selectedOption": answer if isinstance(answer, int) else None,
                    "correctOption": correct_option,
                    "score": score,
                    "isCorrect": is_correct,
                    "explanation": feedback,
                    "source": "AI-generated practice assessment",
                })

            percentage = round(total_score / len(questions), 1)
            marks_obtained = round(total_score / 100, 1)
            submission_id = str(uuid4())
            completed_at = datetime.now(timezone.utc).isoformat()
            topic_scores: dict[str, dict[str, int]] = {}
            for item in results:
                topic = item["topic"]
                stats = topic_scores.setdefault(topic, {"score": 0, "total": 0})
                stats["total"] += 1
                stats["score"] += int(bool(item["isCorrect"]))
            weakest_topic = min(
                topic_scores,
                key=lambda name: topic_scores[name]["score"] / topic_scores[name]["total"],
            )
            result = {
                "submissionId": submission_id,
                "assessmentId": assessment_id,
                "courseId": course_id,
                "assessmentTitle": assessment["title"],
                "courseCode": str(assessment.get("courseCode") or ""),
                "topics": list(topic_scores),
                "difficulty": assessment.get("difficulty", "Intermediate"),
                "aiGenerated": True,
                "official": False,
                "score": marks_obtained,
                "marksObtained": marks_obtained,
                "maximumScore": len(questions),
                "totalQuestions": len(questions),
                "percentage": percentage,
                "questionResults": results,
                "topicBreakdown": [
                    {
                        "topic": name,
                        "score": stats["score"],
                        "total": stats["total"],
                        "percentage": round(stats["score"] * 100 / stats["total"], 1),
                    }
                    for name, stats in topic_scores.items()
                ],
                "completedAt": completed_at,
                "timeSpentSeconds": assessment.get("timeSpentSeconds", 0),
                "evidenceNote": (
                    "Descriptive scores are AI-generated estimates; this is not an official university grade."
                    if assessment.get("format") == "descriptive"
                    else "This is AI-generated practice and is not an official university grade."
                ),
                "recommendedFollowUp": {
                    "topic": weakest_topic,
                    "reason": "Review topics with the lowest accuracy before your next assignment.",
                    "practicePrompt": (
                        f"I completed the AI practice assignment '{assessment['title']}' "
                        f"for {assessment.get('courseCode') or 'my course'} and scored {percentage}%. "
                        f"Help me review these missed topics: "
                        f"{', '.join(dict.fromkeys(item['topic'] for item in results if not item['isCorrect'])) or weakest_topic}. "
                        "Explain the concepts using this practice result as learning evidence, not as an official grade."
                    ),
                },
            }
            graded_record = await self._repository.transition_practice_assessment_state(
                assessment_id,
                ["SUBMITTED"],
                "GRADED",
                {"result": result, "submissionId": submission_id, "gradedAt": completed_at},
            )
            result = graded_record.get("result", result)

        await self._repository.save_agent_record(
            "practice_submissions",
            assessment_id,
            {
                **result,
                "answers": assessment.get("submittedAnswers", answers),
                "courseId": course_id,
                "assessmentId": assessment_id,
                "status": "GRADED",
            },
        )
        published_record = await self._repository.transition_practice_assessment_state(
            assessment_id,
            ["GRADED"],
            "RESULTS_PUBLISHED",
            {
                "resultsPublishedAt": datetime.now(timezone.utc).isoformat(),
                "learningAnalysisStatus": "LEARNING_ANALYSIS_PENDING",
            },
        )
        published_result = published_record.get("result")
        if not isinstance(published_result, dict):
            raise ProviderError("The graded practice assignment could not be published.")
        return {
            **published_result,
            "status": published_record.get("status"),
            "learningAnalysisStatus": published_record.get("learningAnalysisStatus"),
        }


class AssignmentLearningAgent:
    name = "assignment_learning"
    minimum_mastery_evidence = 3

    def __init__(self, repository: SupabaseLearningRepository) -> None:
        self._repository = repository

    @staticmethod
    def _is_published(record: dict[str, Any]) -> bool:
        return _is_published_practice_assessment(record)

    async def _completed_records(self) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
        student_data = await self._repository.get_student_data()
        courses = {
            str(course["id"]): course
            for course in student_data["courses"]
            if isinstance(course, dict) and course.get("id")
        }
        records = await self._repository.list_agent_records("practice_assessments", 1000)
        completed = [
            record
            for record in records
            if isinstance(record, dict)
            and self._is_published(record)
            and str(record.get("courseId") or "") in courses
        ]
        completed.sort(
            key=lambda record: str(
                record.get("result", {}).get("completedAt")
                or record.get("createdAt")
                or ""
            )
        )
        return completed, courses

    @staticmethod
    def _card(
        record: dict[str, Any],
        course: dict[str, Any],
        assignment_number: int,
    ) -> dict[str, Any]:
        result = record["result"]
        subject = str(record.get("subject") or course.get("title") or course.get("code") or "")
        return {
            "id": record["id"],
            "assignmentNumber": assignment_number,
            "name": str(record.get("title") or "Practice assignment"),
            "displayName": f"Assignment {assignment_number} — {subject}",
            "subject": subject,
            "courseId": record.get("courseId"),
            "courseCode": str(record.get("courseCode") or course.get("code") or ""),
            "topics": list(record.get("topics") or result.get("topics") or []),
            "completionDate": result.get("completedAt"),
            "score": result.get("marksObtained", result.get("score", 0)),
            "maximumScore": result.get("maximumScore", result.get("totalQuestions", 0)),
            "percentage": result.get("percentage", 0),
            "completionStatus": record.get("status"),
            "learningAnalysisStatus": record.get("learningAnalysisStatus") or "LEARNING_ANALYSIS_PENDING",
            "difficulty": record.get("difficulty", "Intermediate"),
            "totalQuestions": result.get("totalQuestions", 0),
        }

    @staticmethod
    def _analyze(
        records: list[dict[str, Any]],
        courses: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        course_records = courses or {}
        topic_evidence: dict[tuple[str, str], list[dict[str, Any]]] = {}
        difficulty_evidence: dict[str, dict[str, int]] = {}
        correct_count = 0
        question_count = 0
        for assignment in records:
            difficulty = str(assignment.get("difficulty") or "Intermediate")
            difficulty_stats = difficulty_evidence.setdefault(difficulty, {"correct": 0, "attempted": 0})
            for question in assignment.get("result", {}).get("questionResults", []):
                if not isinstance(question, dict) or not isinstance(question.get("isCorrect"), bool):
                    continue
                topic = str(question.get("topic") or "Uncategorized").strip() or "Uncategorized"
                course_id = str(assignment.get("courseId") or "")
                course = course_records.get(course_id, {})
                item = {
                    "assignmentId": assignment["id"],
                    "topic": topic,
                    "courseId": course_id or None,
                    "courseCode": str(assignment.get("courseCode") or course.get("code") or ""),
                    "completedAt": assignment.get("result", {}).get("completedAt"),
                    "correct": question["isCorrect"],
                }
                topic_evidence.setdefault((course_id, topic.casefold()), []).append(item)
                question_count += 1
                correct_count += int(question["isCorrect"])
                difficulty_stats["attempted"] += 1
                difficulty_stats["correct"] += int(question["isCorrect"])

        topic_reports = []
        for (course_id, _), evidence in sorted(
            topic_evidence.items(),
            key=lambda item: (
                item[1][0]["courseCode"].casefold(),
                item[1][0]["topic"].casefold(),
            ),
        ):
            topic = str(evidence[0].get("topic") or "")
            attempts = len(evidence)
            correct = sum(int(item["correct"]) for item in evidence)
            accuracy = round(correct * 100 / attempts, 1)
            assignment_results: dict[str, dict[str, int]] = {}
            for item in evidence:
                stats = assignment_results.setdefault(item["assignmentId"], {"correct": 0, "attempted": 0})
                stats["attempted"] += 1
                stats["correct"] += int(item["correct"])
            ordered_assignments = sorted(
                assignment_results.items(),
                key=lambda item: next(
                    (entry["completedAt"] or "" for entry in evidence if entry["assignmentId"] == item[0]),
                    "",
                ),
            )
            improvement = None
            if len(ordered_assignments) >= 2:
                first = ordered_assignments[0][1]
                latest = ordered_assignments[-1][1]
                improvement = round(
                    latest["correct"] * 100 / latest["attempted"]
                    - first["correct"] * 100 / first["attempted"],
                    1,
                )
            topic_reports.append({
                "topic": topic,
                "courseId": course_id or None,
                "courseCode": evidence[0]["courseCode"],
                "attempts": attempts,
                "correct": correct,
                "accuracy": accuracy,
                "estimatedMastery": accuracy if attempts >= AssignmentLearningAgent.minimum_mastery_evidence else None,
                "evidenceStatus": (
                    "MEASURED"
                    if attempts >= AssignmentLearningAgent.minimum_mastery_evidence
                    else "INSUFFICIENT_EVIDENCE"
                ),
                "assignmentCount": len(assignment_results),
                "repeatedIncorrectAnswers": sum(not item["correct"] for item in evidence),
                "improvementAcrossAssignments": improvement,
            })

        total_assignments = len(records)
        return {
            "totalAssignmentsCompleted": total_assignments,
            "totalQuestionsAttempted": question_count,
            "correctAnswers": correct_count,
            "overallAccuracy": round(correct_count * 100 / question_count, 1) if question_count else None,
            "overallTopicMastery": topic_reports,
            "topicsRequiringImprovement": [
                topic for topic in topic_reports
                if topic["accuracy"] < 70 or topic["evidenceStatus"] == "INSUFFICIENT_EVIDENCE"
            ],
            "strengths": [
                topic for topic in topic_reports
                if topic["accuracy"] >= 80 and topic["evidenceStatus"] == "MEASURED"
            ],
            "repeatedIncorrectTopics": [
                topic for topic in topic_reports if topic["repeatedIncorrectAnswers"] >= 2
            ],
            "difficultyPerformance": [
                {
                    "difficulty": difficulty,
                    "attempted": stats["attempted"],
                    "correct": stats["correct"],
                    "accuracy": round(stats["correct"] * 100 / stats["attempted"], 1),
                }
                for difficulty, stats in sorted(difficulty_evidence.items())
            ],
            "personalizedLearningPlan": [
                {
                    "topic": topic["topic"],
                    "courseId": topic["courseId"],
                    "courseCode": topic["courseCode"],
                    "priority": "high" if topic["accuracy"] < 50 else "medium",
                    "action": (
                        "Complete more questions on this topic to build reliable evidence."
                        if topic["evidenceStatus"] == "INSUFFICIENT_EVIDENCE"
                        else "Review course materials, then practice this topic again."
                    ),
                    "reason": (
                        f"{topic['accuracy']}% measured accuracy across {topic['attempts']} questions."
                    ),
                    "evidenceStatus": topic["evidenceStatus"],
                }
                for topic in topic_reports
                if topic["accuracy"] < 70 or topic["evidenceStatus"] == "INSUFFICIENT_EVIDENCE"
            ],
            "evidenceNote": (
                "Performance is measured from published, backend-graded assignments. "
                "Mastery estimates are withheld until a topic has at least three answered questions."
            ),
        }

    async def history(self) -> dict[str, Any]:
        records, courses = await self._completed_records()
        cards = [
            self._card(record, courses[str(record["courseId"])], index + 1)
            for index, record in enumerate(records)
        ]
        return {
            "overview": self._analyze(records, courses),
            "completedAssignments": cards,
        }

    async def assignment_detail(self, assessment_id: str) -> dict[str, Any] | None:
        record = await self._repository.get_agent_record("practice_assessments", assessment_id)
        if not record or not self._is_published(record):
            return None
        student_data = await self._repository.get_student_data(str(record.get("courseId") or ""))
        course = next(
            (
                item for item in student_data["courses"]
                if str(item.get("id")) == str(record.get("courseId"))
            ),
            None,
        )
        if not course:
            return None
        completed, _ = await self._completed_records()
        position = next((index + 1 for index, item in enumerate(completed) if item["id"] == assessment_id), None)
        if position is None:
            return None
        card = self._card(record, course, position)
        individual = self._analyze([record], {str(record["courseId"]): course})
        return {
            "assignment": card,
            "details": {
                "totalQuestions": record["result"]["totalQuestions"],
                "correctAnswers": sum(
                    item["isCorrect"] is True
                    for item in record["result"]["questionResults"]
                ),
                "incorrectAnswers": sum(
                    item["isCorrect"] is False
                    for item in record["result"]["questionResults"]
                ),
                "marksObtained": record["result"].get("marksObtained", record["result"].get("score", 0)),
                "maximumScore": record["result"].get("maximumScore", record["result"]["totalQuestions"]),
                "percentage": record["result"]["percentage"],
                "topicPerformance": record["result"].get("topicBreakdown", []),
                "questionResults": record["result"]["questionResults"],
                "difficultyPerformance": individual["difficultyPerformance"],
                "strengths": individual["strengths"],
                "weaknesses": individual["topicsRequiringImprovement"],
            },
        }

    async def analyze_completed_assignment(self, assessment_id: str) -> dict[str, Any]:
        record = await self._repository.get_agent_record("practice_assessments", assessment_id)
        if not record or not self._is_published(record):
            return {"status": "NOT_ELIGIBLE"}
        if record.get("learningAnalysisStatus") == "LEARNING_ANALYSIS_COMPLETED":
            return {"status": "LEARNING_ANALYSIS_COMPLETED"}
        try:
            await self._repository.transition_practice_assessment_state(
                assessment_id,
                ["RESULTS_PUBLISHED"],
                "RESULTS_PUBLISHED",
                {"learningAnalysisStatus": "LEARNING_ANALYSIS_PENDING"},
            )
            completed, _ = await self._completed_records()
            student_data = await self._repository.get_student_data()
            courses = {
                str(course["id"]): course
                for course in student_data["courses"]
                if isinstance(course, dict) and course.get("id")
            }
            analysis = self._analyze(completed, courses)
            await self._repository.transition_practice_assessment_state(
                assessment_id,
                ["RESULTS_PUBLISHED"],
                "RESULTS_PUBLISHED",
                {
                    "learningAnalysisStatus": "LEARNING_ANALYSIS_COMPLETED",
                    "learningAnalysis": analysis,
                    "learningAnalysisUpdatedAt": datetime.now(timezone.utc).isoformat(),
                    "learningAnalysisError": None,
                },
            )
            return {"status": "LEARNING_ANALYSIS_COMPLETED", "analysis": analysis}
        except Exception as error:
            try:
                await self._repository.transition_practice_assessment_state(
                    assessment_id,
                    ["RESULTS_PUBLISHED"],
                    "RESULTS_PUBLISHED",
                    {
                        "learningAnalysisStatus": "LEARNING_ANALYSIS_FAILED",
                        "learningAnalysisError": "Analysis could not be completed. Retry it.",
                        "learningAnalysisUpdatedAt": datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception as state_error:
                logging.getLogger(__name__).error(
                    "Could not persist failed assignment learning-analysis status (%s).",
                    type(state_error).__name__,
                )

            logging.getLogger(__name__).warning(
                "Assignment learning analysis failed (%s).",
                type(error).__name__,
            )
            return {
                "status": "LEARNING_ANALYSIS_FAILED",
                "message": "Analysis could not be completed. Retry it.",
            }


@dataclass(frozen=True)
class LearningAgentServices:
    student_modeling: StudentModelingAgent
    knowledge_tracing: KnowledgeTracingAgent
    learning_analytics: LearningAnalyticsAgent
    knowledge_graph: KnowledgeGraphAgent
    recommendation: RecommendationAgent
    explainability: ExplainabilityAgent
    assessment: AssessmentAgent
    assignment_learning: AssignmentLearningAgent


def create_learning_agent_services(
    provider: LLMProvider | None,
    settings: Settings,
    repository: SupabaseLearningRepository,
) -> LearningAgentServices:
    knowledge_tracing = KnowledgeTracingAgent(repository)
    knowledge_graph = KnowledgeGraphAgent(repository)
    return LearningAgentServices(
        student_modeling=StudentModelingAgent(repository),
        knowledge_tracing=knowledge_tracing,
        learning_analytics=LearningAnalyticsAgent(repository, knowledge_tracing),
        knowledge_graph=knowledge_graph,
        recommendation=RecommendationAgent(repository, knowledge_graph),
        explainability=ExplainabilityAgent(),
        assessment=AssessmentAgent(provider, settings, repository, knowledge_tracing),
        assignment_learning=AssignmentLearningAgent(repository),
    )
