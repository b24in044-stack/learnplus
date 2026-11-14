import json
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
        practice_submissions = [
            item for item in await self._repository.list_agent_records("practice_submissions")
            if not course_id or item.get("courseId") == course_id
        ]
        practice_scores = [
            float(item["percentage"])
            for item in practice_submissions
            if isinstance(item.get("percentage"), (int, float))
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
        topic: str,
        difficulty: str,
        learning_objectives: list[str],
        question_count: int,
        question_format: Literal["mcq", "descriptive"],
    ) -> dict[str, Any]:
        await self._repository.get_student_data(course_id)
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
            "course_id": course_id,
            "topic": topic,
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
            "aiGenerated": True,
            "assessmentType": "practice",
            "title": assessment.title,
            "topic": topic,
            "difficulty": difficulty,
            "format": question_format,
            "questions": questions,
            "createdAt": datetime.now(timezone.utc),
        }
        await self._repository.save_agent_record("practice_assessments", assessment_id, record)
        return {
            "assessmentId": assessment_id,
            "courseId": course_id,
            "title": assessment.title,
            "topic": topic,
            "difficulty": difficulty,
            "format": question_format,
            "aiGenerated": True,
            "official": False,
            "questions": public_questions,
        }

    async def evaluate(
        self,
        assessment_id: str,
        answers: dict[str, int | str],
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
            answer = answers.get(question["id"])
            if question.get("format") == "mcq":
                options = question.get("options")
                if answer is not None and (
                    type(answer) is not int
                    or not isinstance(options, list)
                    or answer < 0
                    or answer >= len(options)
                ):
                    raise ValueError("A multiple-choice answer is outside the available options.")
            elif answer is not None and (not isinstance(answer, str) or len(answer) > 4000):
                raise ValueError("A descriptive answer must be text of at most 4000 characters.")

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
                        "student_answer": str(answers.get(question["id"], ""))[:4000],
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
        tracing_evidence = []
        total_score = 0.0
        for question in questions:
            answer = answers.get(question["id"])
            if question.get("format") == "mcq":
                is_correct = answer == question.get("answer_index")
                score = 100.0 if is_correct else 0.0
                feedback = question.get("explanation", "")[:1000]
            else:
                answer_text = answer if isinstance(answer, str) else ""
                evaluation = descriptive_results[question["id"]]
                score = float(evaluation["score"])
                is_correct = score >= 70
                feedback = evaluation["feedback"]
            total_score += score
            results.append({
                "questionId": question["id"],
                "questionText": question["question"],
                "topic": question["topic"],
                "score": score,
                "feedback": feedback,
                "source": "AI-generated practice assessment",
            })
            tracing_evidence.append({
                "concept_id": _concept_id(question["topic"]),
                "topic": question["topic"],
                "mastered": is_correct,
            })

        percentage = round(total_score / len(questions), 1)
        submission_id = str(uuid4())
        result = {
            "submissionId": submission_id,
            "assessmentId": assessment_id,
            "courseId": course_id,
            "assessmentTitle": assessment["title"],
            "aiGenerated": True,
            "official": False,
            "score": percentage,
            "totalQuestions": len(questions),
            "percentage": percentage,
            "questionResults": results,
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "evidenceNote": "Descriptive scores are AI-generated estimates; this is not an official university grade.",
        }
        await self._repository.save_agent_record(
            "practice_submissions",
            submission_id,
            {
                **result,
                "answers": answers,
                "courseId": course_id,
                "assessmentId": assessment_id,
            },
        )
        await self._repository.record_learning_activity(
            "ai_practice_assessment_completed",
            course_id,
            assessment_id,
        )
        mastery = await self._knowledge_tracing.update_from_responses(
            course_id,
            assessment_id,
            tracing_evidence,
        )
        result["masteryUpdates"] = mastery
        return result


@dataclass(frozen=True)
class LearningAgentServices:
    student_modeling: StudentModelingAgent
    knowledge_tracing: KnowledgeTracingAgent
    learning_analytics: LearningAnalyticsAgent
    knowledge_graph: KnowledgeGraphAgent
    recommendation: RecommendationAgent
    explainability: ExplainabilityAgent
    assessment: AssessmentAgent


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
    )
