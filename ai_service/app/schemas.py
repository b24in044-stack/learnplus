from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    message: str = Field(min_length=1, max_length=4000)
    use_documents: bool = False
    course_id: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("message")
    @classmethod
    def nonblank_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message cannot be blank.")
        return cleaned

    @field_validator("course_id")
    @classmethod
    def nonblank_course_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Course ID cannot be blank.")
        return cleaned

    @model_validator(mode="after")
    def documents_require_course(self):
        if self.use_documents and not self.course_id:
            raise ValueError("A course ID is required for document-grounded tutoring.")
        return self


class AgentStep(BaseModel):
    agent_id: str
    name: str
    description: str
    duration_ms: int = Field(ge=0)
    status: Literal["completed"] = "completed"


class Citation(BaseModel):
    source_chunk_id: UUID | None = None
    chunk_index: int | None = None
    document_id: UUID
    document_title: str
    page_number: int | None = None
    excerpt: str
    similarity: float | None = None


class DocumentIngestResponse(BaseModel):
    document_id: UUID
    status: Literal["ready"]
    chunks_count: int
    embedding_model: str


class RAGSearchRequest(BaseModel):
    course_id: str = Field(min_length=1, max_length=128)
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=5, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def nonblank_query(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Query cannot be blank.")
        return cleaned

    @field_validator("course_id")
    @classmethod
    def nonblank_course_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Course ID cannot be blank.")
        return cleaned


class ChatResponse(BaseModel):
    id: UUID
    session_id: UUID
    role: Literal["assistant"] = "assistant"
    content: str
    timestamp: datetime
    intent: str
    provider: str
    citations: list[Citation] = Field(default_factory=list)
    agent_steps: list[AgentStep]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    provider: str
    provider_configured: bool
    supabase_configured: bool
    supabase_connected: bool
    embedding_available: bool
    rag_configured: bool


class AgentExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_type: Literal[
        "personalized_learning",
        "student_modeling",
        "knowledge_tracing",
        "learning_analytics",
        "insights",
        "knowledge_graph",
        "recommendations",
        "assessment_generate",
        "assessment_evaluate",
        "research_planning",
    ]
    session_id: UUID | None = None
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    use_documents: bool = False
    course_id: str | None = Field(default=None, min_length=1, max_length=128)
    topic: str | None = Field(default=None, min_length=1, max_length=160)
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = "Intermediate"
    learning_objectives: list[str] = Field(default_factory=list, max_length=8)
    question_count: int = Field(default=5, ge=1, le=10)
    question_format: Literal["mcq", "descriptive"] = "mcq"
    assessment_id: str | None = Field(default=None, min_length=1, max_length=128)
    answers: dict[str, int | str] = Field(default_factory=dict, max_length=10)

    @field_validator("message", "topic", "course_id", "assessment_id")
    @classmethod
    def nonblank_optional_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This value cannot be blank.")
        return cleaned

    @field_validator("learning_objectives")
    @classmethod
    def valid_objectives(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if isinstance(value, str) and value.strip()]
        if len(cleaned) != len(values) or any(len(value) > 300 for value in cleaned):
            raise ValueError("Learning objectives must be non-empty strings of at most 300 characters.")
        return cleaned

    @model_validator(mode="after")
    def validate_task_fields(self):
        if self.task_type in {
            "personalized_learning",
            "student_modeling",
            "knowledge_tracing",
            "learning_analytics",
            "insights",
            "recommendations",
        } and any((self.message, self.assessment_id, self.answers)):
            raise ValueError("The selected learning task does not accept message or assessment fields.")
        if self.task_type in {"assessment_generate", "knowledge_graph"} and not self.course_id:
            raise ValueError("A course ID is required for this task.")
        if self.task_type == "assessment_generate" and not self.topic:
            raise ValueError("A topic is required to generate a practice assessment.")
        if self.task_type == "assessment_evaluate" and not self.assessment_id:
            raise ValueError("An assessment ID is required to evaluate a submission.")
        if self.task_type == "assessment_evaluate" and self.message:
            raise ValueError("Assessment evaluation does not accept a message.")
        return self


class CourseAgentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("course_id")
    @classmethod
    def nonblank_course_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Course ID cannot be blank.")
        return cleaned


class AssessmentGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_id: str = Field(min_length=1, max_length=128)
    topic: str = Field(min_length=1, max_length=160)
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = "Intermediate"
    learning_objectives: list[str] = Field(default_factory=list, max_length=8)
    question_count: int = Field(default=5, ge=1, le=10)
    question_format: Literal["mcq", "descriptive"] = "mcq"

    @field_validator("course_id", "topic")
    @classmethod
    def nonblank_values(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This value cannot be blank.")
        return cleaned

    @field_validator("learning_objectives")
    @classmethod
    def valid_objectives(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if isinstance(value, str) and value.strip()]
        if len(cleaned) != len(values) or any(len(value) > 300 for value in cleaned):
            raise ValueError("Learning objectives must be non-empty strings of at most 300 characters.")
        return cleaned


class FacultyAssessmentGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    course_id: str = Field(alias="courseId", min_length=1, max_length=128)
    topic: str = Field(min_length=1, max_length=160)
    difficulty: Literal["Beginner", "Intermediate", "Advanced"] = "Intermediate"
    question_count: int = Field(alias="questionCount", ge=1, le=10)
    bloom_level: str = Field(
        default="Analysis & Evaluation",
        alias="bloomLevel",
        min_length=1,
        max_length=80,
    )

    @field_validator("course_id", "topic", "bloom_level")
    @classmethod
    def nonblank_values(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This value cannot be blank.")
        return cleaned


class AssessmentSubmissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: dict[str, int | str] = Field(max_length=10)


class AgentAvailability(BaseModel):
    agent_id: str
    status: Literal["available", "degraded", "unavailable"]
    dependencies: list[str]


class AgentStatusResponse(BaseModel):
    available: list[str]
    unavailable: list[str]
    agents: list[AgentAvailability]
    rag_available: bool


class AgentExecutionResponse(BaseModel):
    task_type: str
    data: dict[str, object]
    agent_steps: list[AgentStep]
