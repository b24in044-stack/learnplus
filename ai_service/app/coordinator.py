import re
import time
from dataclasses import dataclass
from typing import Any

from ai_service.app.agents.tutor import TutorAgent
from ai_service.app.errors import UnsupportedIntentError


@dataclass(frozen=True)
class CoordinatedAnswer:
    content: str
    intent: str
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    coordinator_duration_ms: int
    tutor_duration_ms: int


@dataclass(frozen=True)
class CoordinatedWorkflow:
    task_type: str
    data: dict[str, Any]
    agent_steps: list[dict[str, Any]]


class Coordinator:
    """Routes authenticated requests to implemented specialist services."""

    _assessment_pattern = re.compile(r"\b(generate|create|grade|score)\b.*\b(quiz|assessment|test|questions?)\b", re.I)
    _analytics_pattern = re.compile(r"\b(analytics|performance trend|weak topics?|learning progress report)\b", re.I)
    _intent_patterns = (
        ("examination_preparation", re.compile(r"\b(exam|examination|previous paper|revision plan)\b", re.I)),
        ("assignment_support", re.compile(r"\b(assignment|submission|coding task|homework)\b", re.I)),
        ("project_research", re.compile(r"\b(project|research|paper|milestone|report)\b", re.I)),
        ("academic_support", re.compile(r"\b(syllabus|outcome|course|unit|lecture|notes?)\b", re.I)),
        ("performance_support", re.compile(r"\b(score|marks|progress|weak topic|performance)\b", re.I)),
    )

    def __init__(self, tutor: TutorAgent | None, agents: Any = None) -> None:
        self._tutor = tutor
        self._agents = agents

    async def handle(
        self,
        history: list[dict[str, str]],
        message: str,
        sources: list[dict[str, object]] | None = None,
        learning_context: dict[str, Any] | None = None,
    ) -> CoordinatedAnswer:
        if self._tutor is None:
            raise UnsupportedIntentError("The Tutor Agent is not configured.")
        coordinator_started = time.perf_counter()
        if self._assessment_pattern.search(message):
            raise UnsupportedIntentError("Assessment generation is not available in this AI service.")
        if self._analytics_pattern.search(message):
            raise UnsupportedIntentError("Learning analytics are not available in this AI service.")

        intent = "summarize" if re.search(r"\b(summarize|summary|overview)\b", message, re.I) else "tutoring"
        for candidate, pattern in self._intent_patterns:
            if pattern.search(message):
                intent = candidate
                break
        tutor_started = time.perf_counter()
        if learning_context is None:
            content, usage = await self._tutor.answer(history, message, sources)
        else:
            content, usage = await self._tutor.answer(
                history,
                message,
                sources,
                learning_context=learning_context,
            )
        tutor_ms = max(0, round((time.perf_counter() - tutor_started) * 1000))
        coordinator_ms = max(0, round((time.perf_counter() - coordinator_started) * 1000))
        return CoordinatedAnswer(
            content=content,
            intent=intent,
            provider=str(usage["provider"]),
            model=str(usage["model"]),
            input_tokens=int(usage["input_tokens"]),
            output_tokens=int(usage["output_tokens"]),
            coordinator_duration_ms=coordinator_ms,
            tutor_duration_ms=tutor_ms,
        )

    async def execute(self, task_type: str, **payload: Any) -> CoordinatedWorkflow:
        if task_type == "research_planning":
            topic = str(payload.get("topic") or "").strip()
            problem = str(payload.get("message") or "").strip()
            if not topic:
                raise ValueError("A research topic is required.")
            return CoordinatedWorkflow(
                task_type,
                {
                    "topic": topic,
                    "source_verified": False,
                    "notice": "This is a structured AI planning suggestion. No literature, citation, author, DOI, or publication has been verified.",
                    "problem_statement": problem or f"Define the measurable problem addressed by {topic}.",
                    "objectives": [
                        f"Define the scope and measurable outcome for {topic}.",
                        "Identify the target population, context, and constraints.",
                        "Evaluate the proposed approach using reproducible criteria.",
                    ],
                    "research_questions": [
                        f"What factors most affect the outcome in {topic}?",
                        "How can the proposed approach be evaluated against a clear baseline?",
                    ],
                    "proposal_structure": ["Introduction", "Problem statement", "Objectives", "Literature review", "Methodology", "Evaluation", "Limitations", "References"],
                    "literature_review_plan": [
                        "Search authoritative scholarly indexes using topic-specific terms.",
                        "Record title, authors, venue, year, DOI, URL, and inclusion rationale.",
                        "Verify every citation against the source before submission.",
                    ],
                    "methodology_options": ["Systematic review", "Comparative experiment", "Survey or interview study", "Prototype and evaluation"],
                    "milestones": ["Scope and questions", "Source collection and verification", "Methodology design", "Data or prototype work", "Analysis and review", "Final submission"],
                },
                [{
                    "agent_id": "research_planning",
                    "name": "Research Planning Agent",
                    "description": "Generated a source-unverified research plan without fabricating literature or citations.",
                    "duration_ms": 0,
                    "status": "completed",
                }],
            )
        if self._agents is None:
            raise UnsupportedIntentError("The requested specialist agents are not configured.")

        steps: list[dict[str, Any]] = []

        async def run(agent_id: str, description: str, operation):
            started = time.perf_counter()
            result = await operation
            steps.append({
                "agent_id": agent_id,
                "name": agent_id.replace("_", " ").title() + " Agent",
                "description": description,
                "duration_ms": max(0, round((time.perf_counter() - started) * 1000)),
                "status": "completed",
            })
            return result

        course_id = payload.get("course_id")
        if task_type == "personalized_learning":
            profile = await run(
                "student_modeling",
                "Built an explainable profile from the authenticated student's authorized records.",
                self._agents.student_modeling.build_profile(course_id),
            )
            mastery = await run(
                "knowledge_tracing",
                "Estimated concept mastery from recorded graded practice responses.",
                self._agents.knowledge_tracing.estimate(course_id),
            )
            analytics = await run(
                "learning_analytics",
                "Separated verified academic marks, practice scores, and estimated mastery.",
                self._agents.learning_analytics.analyze(course_id),
            )
            recommendations = await run(
                "recommendation",
                "Selected revision actions supported by course topics and learning evidence.",
                self._agents.recommendation.recommend(course_id),
            )
            data = {
                "profile": profile,
                "mastery": mastery,
                "analytics": analytics,
                "recommendations": recommendations,
            }
            data["explainability"] = await run(
                "explainability",
                "Described the evidence and uncertainty behind the personalized learning results.",
                self._agents.explainability.explain(
                    data,
                    [
                        {"source": "student-owned learning profile", "fields": ["enrollments", "activity counts"]},
                        {"source": "AI-generated practice responses", "fields": ["estimated concept mastery"]},
                        {"source": "verified_subject_marks", "fields": ["official academic marks"]},
                        {"source": "published course records", "fields": ["topics and explicit prerequisites"]},
                    ],
                ),
            )
            return CoordinatedWorkflow(task_type, data, steps)

        if task_type == "student_modeling":
            data = await run(
                "student_modeling",
                "Built an explainable profile from the authenticated student's authorized records.",
                self._agents.student_modeling.build_profile(course_id),
            )
        elif task_type == "knowledge_tracing":
            data = await run(
                "knowledge_tracing",
                "Estimated mastery using the documented Bayesian evidence model.",
                self._agents.knowledge_tracing.estimate(course_id),
            )
        elif task_type in {"insights", "learning_analytics"}:
            data = await run(
                "learning_analytics",
                "Analyzed verified marks, server-graded results, practice scores, and estimated mastery separately.",
                self._agents.learning_analytics.analyze(course_id),
            )
        elif task_type == "knowledge_graph":
            if not course_id:
                raise ValueError("A course ID is required for the knowledge graph.")
            data = await run(
                "knowledge_graph",
                "Built a course graph using only explicit source relationships.",
                self._agents.knowledge_graph.build(course_id),
            )
        elif task_type == "recommendations":
            await run(
                "student_modeling",
                "Loaded the authenticated student's authorized learning profile.",
                self._agents.student_modeling.build_profile(course_id),
            )
            data = await run(
                "recommendation",
                "Selected evidence-backed revision and practice actions.",
                self._agents.recommendation.recommend(course_id),
            )
        elif task_type == "assessment_generate":
            data = await run(
                "assessment",
                "Generated an explicitly AI-labeled practice assessment using Groq.",
                self._agents.assessment.generate(
                    course_id=payload["course_id"],
                    topic=payload["topic"],
                    difficulty=payload["difficulty"],
                    learning_objectives=payload["learning_objectives"],
                    question_count=payload["question_count"],
                    question_format=payload["question_format"],
                ),
            )
        elif task_type == "assessment_evaluate":
            data = await run(
                "assessment",
                "Graded the student's AI-generated practice submission.",
                self._agents.assessment.evaluate(payload["assessment_id"], payload["answers"]),
            )
            mastery = data.get("masteryUpdates", [])
            analytics = await run(
                "learning_analytics",
                "Recomputed learning insights after the practice submission.",
                self._agents.learning_analytics.analyze(data.get("courseId")),
            )
            recommendations = await run(
                "recommendation",
                "Selected follow-up practice from updated concept evidence.",
                self._agents.recommendation.recommend(data.get("courseId")),
            )
            data["analytics"] = analytics
            data["recommendations"] = recommendations
            data["masteryUpdates"] = mastery
        else:
            raise UnsupportedIntentError("The requested coordinator task is not implemented.")

        data["explainability"] = await run(
            "explainability",
            "Described the evidence and uncertainty behind the agent output.",
            self._agents.explainability.explain(
                data,
                [{
                    "source": "authenticated student's authorized Supabase records",
                    "fields": sorted(key for key in data if key != "explainability"),
                }],
            ),
        )
        return CoordinatedWorkflow(task_type, data, steps)
