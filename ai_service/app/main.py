import asyncio
import logging
import math
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from ai_service.app.auth import AuthenticatedUser, authenticate_faculty_request, authenticate_request
from ai_service.app.agents.learning import create_learning_agent_services
from ai_service.app.agents.tutor import TutorContextLimitError
from ai_service.app.config import Settings, get_settings
from ai_service.app.coordinator import Coordinator
from ai_service.app.database import SupabaseConversationStore
from ai_service.app.embeddings import SentenceTransformerEmbeddings
from ai_service.app.errors import (
    ConversationNotFoundError,
    ForbiddenError,
    ProviderError,
    ProviderRateLimitError,
    ServiceUnavailableError,
    UnauthorizedError,
    UnsupportedIntentError,
)
from ai_service.app.logging_config import configure_logging
from ai_service.app.learning_repository import SupabaseLearningRepository
from ai_service.app.providers.factory import create_provider
from ai_service.app.rag import (
    ChunkLimitExceeded,
    SupabaseRAGRepository,
    chunk_pages,
    extract_document,
)
from ai_service.app.rate_limit import UserRateLimiter
from ai_service.app.schemas import (
    AgentAvailability,
    AgentExecutionRequest,
    AgentExecutionResponse,
    AgentStep,
    AgentStatusResponse,
    AssessmentGenerateRequest,
    AssessmentSubmissionRequest,
    FacultyAssessmentGenerateRequest,
    Citation,
    ChatRequest,
    ChatResponse,
    CourseAgentRequest,
    DocumentIngestResponse,
    HealthResponse,
    RAGSearchRequest,
)
from ai_service.app.supabase_client import check_supabase_connectivity

configure_logging()
logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    provider_override=None,
    auth_override=None,
    store_factory=None,
    embedding_override=None,
    rag_repository_factory=None,
    learning_repository_factory=None,
) -> FastAPI:
    config = settings or get_settings()
    limiter = UserRateLimiter(config.ai_requests_per_minute)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if config.embedding_enabled and application.state.embedding_provider is None:
            application.state.embedding_provider = SentenceTransformerEmbeddings(config)
        if config.embedding_enabled and application.state.embedding_provider is not None:
            try:
                await application.state.embedding_provider.load()
                application.state.embedding_available = True
            except ServiceUnavailableError:
                logger.warning("embedding model initialization failed; RAG endpoints are unavailable")
        try:
            yield
        finally:
            provider = application.state.embedding_provider
            if provider is not None and callable(getattr(provider, "close", None)):
                await provider.close()

    application = FastAPI(
        title="Student Agent AI Service",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.settings = config
    application.state.provider_override = provider_override
    application.state.auth_override = auth_override
    application.state.store_factory = store_factory
    application.state.embedding_provider = embedding_override
    application.state.embedding_available = embedding_override is not None
    application.state.rag_repository_factory = rag_repository_factory
    application.state.learning_repository_factory = learning_repository_factory
    application.state.limiter = limiter
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @application.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request completed",
            extra={
                "request_id": request_id,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000),
            },
        )
        return response

    @application.exception_handler(UnauthorizedError)
    async def unauthorized_handler(_: Request, error: UnauthorizedError):
        return _error_response(401, str(error))

    @application.exception_handler(ForbiddenError)
    async def forbidden_handler(_: Request, error: ForbiddenError):
        return _error_response(403, str(error))

    @application.exception_handler(ConversationNotFoundError)
    async def conversation_handler(_: Request, error: ConversationNotFoundError):
        return _error_response(404, str(error))

    @application.exception_handler(UnsupportedIntentError)
    async def unsupported_handler(_: Request, error: UnsupportedIntentError):
        return _error_response(501, str(error))

    @application.exception_handler(ServiceUnavailableError)
    async def unavailable_handler(_: Request, error: ServiceUnavailableError):
        logger.warning("dependency unavailable", extra={"status_code": 503})
        return _error_response(503, str(error))

    @application.exception_handler(ProviderError)
    async def provider_handler(_: Request, error: ProviderError):
        logger.error("provider request failed", extra={"status_code": 502})
        return _error_response(502, str(error))

    @application.exception_handler(ProviderRateLimitError)
    async def provider_rate_limit_handler(_: Request, error: ProviderRateLimitError):
        from fastapi.responses import JSONResponse

        retry_after = max(1, math.ceil(error.retry_after))
        return JSONResponse(
            status_code=429,
            content={"detail": str(error)},
            headers={"Retry-After": str(retry_after)},
        )

    @application.get("/health", response_model=HealthResponse)
    async def health(request: Request):
        provider_configured = config.provider_is_configured
        supabase_connected = False
        if config.supabase_is_configured:
            try:
                supabase_connected = await asyncio.to_thread(check_supabase_connectivity, config)
            except Exception as error:
                logger.warning(
                    "Supabase health query failed",
                    extra={"supabase_error": type(error).__name__},
                )
        embedding_available = bool(request.app.state.embedding_available)
        return HealthResponse(
            status="ok" if provider_configured and supabase_connected else "degraded",
            service="student-agent-ai",
            provider="groq",
            provider_configured=provider_configured,
            supabase_configured=config.supabase_is_configured,
            supabase_connected=supabase_connected,
            embedding_available=embedding_available,
            rag_configured=bool(
                config.supabase_is_configured
                and config.embedding_enabled
            ),
        )

    async def authenticate(authorization: str | None) -> AuthenticatedUser:
        auth_dependency = application.state.auth_override or authenticate_request
        return await auth_dependency(authorization, config)

    async def authenticate_faculty(authorization: str | None) -> AuthenticatedUser:
        auth_dependency = application.state.auth_override or authenticate_faculty_request
        authenticated = await auth_dependency(authorization, config)
        if authenticated.role != "faculty":
            raise ForbiddenError("AI assessment generation is available to faculty accounts only.")
        return authenticated

    async def get_embeddings(request: Request):
        if not config.embedding_enabled:
            raise ServiceUnavailableError("Document embeddings are disabled on this service.")
        if config.embedding_dimension != 384:
            raise ServiceUnavailableError(
                "The configured Supabase pgvector index supports 384-dimensional embeddings only."
            )
        provider = request.app.state.embedding_provider
        if provider is None:
            provider = SentenceTransformerEmbeddings(config)
            request.app.state.embedding_provider = provider
        try:
            await provider.load()
        except ServiceUnavailableError:
            request.app.state.embedding_available = False
            raise
        request.app.state.embedding_available = True
        return provider

    def create_rag_repository(authorization: str, user_id: UUID):
        repository_factory = application.state.rag_repository_factory or SupabaseRAGRepository
        return repository_factory(
            config,
            authorization.removeprefix("Bearer ").strip(),
            user_id,
        )

    def create_learning_agents(user_id: str | UUID, provider=None, authorization: str | None = None):
        repository_factory = application.state.learning_repository_factory
        if repository_factory:
            repository = repository_factory(config, user_id)
        else:
            if not authorization:
                raise UnauthorizedError("A Supabase access token is required for learning data.")
            token = authorization.removeprefix("Bearer ").strip()
            repository = SupabaseLearningRepository(config, token, user_id)
        return create_learning_agent_services(provider, config, repository)

    def create_provider_if_configured(request: Request):
        if request.app.state.provider_override is not None:
            return request.app.state.provider_override
        if not config.provider_is_configured:
            return None
        return create_provider(config)

    @application.get("/health/provider")
    @application.get("/health/providers", include_in_schema=False)
    async def provider_health(
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        authenticated = await authenticate(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        if not config.provider_is_configured:
            raise ServiceUnavailableError(
                "The configured Groq provider is missing its server-side API key."
            )
        provider = request.app.state.provider_override or create_provider(config)
        try:
            available = await provider.health_check()
        except ProviderError as error:
            raise ServiceUnavailableError("The configured AI provider health check failed.") from error
        return {"status": "ok" if available else "unavailable", "provider": "groq"}

    @application.post("/api/v1/agents/tutor", response_model=ChatResponse)
    @application.post("/v1/chat", response_model=ChatResponse)
    @application.post("/api/v1/chat", response_model=ChatResponse, include_in_schema=False)
    async def chat(
        payload: ChatRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        authenticated = await authenticate(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        if not config.provider_is_configured and not request.app.state.provider_override:
            raise ServiceUnavailableError(
                "The configured Groq provider is not configured on the AI service."
            )

        provider = request.app.state.provider_override or create_provider(config)
        store_factory_for_request = request.app.state.store_factory or SupabaseConversationStore
        store = store_factory_for_request(
            config,
            authorization.removeprefix("Bearer ").strip(),
            authenticated.id,
        )
        history = await store.get_history(
            payload.session_id,
            authenticated.id,
            config.max_history_messages,
        )
        if sum(len(item["content"]) for item in history) + len(payload.message) > config.max_input_characters:
            raise HTTPException(
                status_code=413,
                detail="Conversation context is too long. Start a new conversation or shorten your question.",
            )

        from ai_service.app.agents.tutor import TutorAgent

        coordinator = Coordinator(TutorAgent(provider, config))
        sources = []
        citations = []
        learning_context = None
        knowledge_graph_duration_ms = 0
        if payload.course_id:
            graph_started = time.perf_counter()
            agents = create_learning_agents(authenticated.id, provider, authorization)
            learning_context = await agents.knowledge_graph.build(payload.course_id)
            knowledge_graph_duration_ms = max(
                0,
                round((time.perf_counter() - graph_started) * 1000),
            )
        if payload.use_documents:
            embeddings = await get_embeddings(request)
            rag_repository = create_rag_repository(authorization, authenticated.id)
            sources = await rag_repository.search(
                await embeddings.embed_query(payload.message),
                limit=5,
                course_id=payload.course_id,
            )
            if not sources:
                raise HTTPException(
                    status_code=404,
                    detail="Your processed documents do not contain a sufficiently relevant passage. Try a more specific question or process a supported document.",
                )
            citations = [
                Citation(
                    source_chunk_id=UUID(str(source["chunk_id"])),
                    chunk_index=source.get("chunk_index"),
                    document_id=UUID(str(source["document_id"])),
                    document_title=str(source["document_title"])[:200],
                    page_number=source.get("page_number"),
                    excerpt=str(source["content"])[:500],
                    similarity=float(source["similarity"]),
                )
                for source in sources
            ]
        try:
            result = await coordinator.handle(
                history,
                payload.message,
                sources or None,
                learning_context,
            )
        except TutorContextLimitError as error:
            raise HTTPException(status_code=413, detail=str(error)) from error
        completed_at = datetime.now(timezone.utc)
        steps = [
            AgentStep(
                agent_id="coordinator",
                name="Coordinator",
                description=f"Classified intent as {result.intent} and selected the Tutor Agent.",
                duration_ms=result.coordinator_duration_ms,
            ),
            AgentStep(
                agent_id="tutor",
                name="Tutor Agent",
                description=f"Generated an academic response using the configured {result.provider} provider.",
                duration_ms=result.tutor_duration_ms,
            ),
        ]
        if learning_context is not None:
            steps.insert(0, AgentStep(
                agent_id="knowledge_graph",
                name="Knowledge Graph Agent",
                description="Loaded explicit course concepts and prerequisite relationships where available.",
                duration_ms=knowledge_graph_duration_ms,
            ))
        metadata = {
            "intent": result.intent,
            "provider": result.provider,
            "model": result.model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "agent_steps": [step.model_dump(mode="json") for step in steps],
            "source_chunk_ids": [str(citation.source_chunk_id) for citation in citations],
        }
        assistant_id = await store.save_turn(
            payload.session_id,
            payload.message,
            result.content,
            metadata,
        )
        logger.info(
            "tutor turn completed",
            extra={
                "request_id": request.state.request_id,
                "agent": "tutor",
                "provider": result.provider,
                "duration_ms": result.coordinator_duration_ms,
            },
        )
        return ChatResponse(
            id=assistant_id,
            session_id=payload.session_id,
            content=result.content,
            timestamp=completed_at,
            intent=result.intent,
            provider=result.provider,
            citations=citations,
            agent_steps=steps,
        )

    class IngestRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")

        document_id: UUID
        course_id: str | None = Field(default=None, min_length=1, max_length=128)

    @application.post("/api/v1/documents/ingest", response_model=DocumentIngestResponse)
    @application.post(
        "/v1/documents/ingest",
        response_model=DocumentIngestResponse,
        include_in_schema=False,
    )
    async def ingest_document(
        payload: IngestRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        authenticated = await authenticate(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        embeddings = await get_embeddings(request)
        repository = create_rag_repository(authorization, authenticated.id)
        try:
            document = await repository.get_document(payload.document_id, payload.course_id)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        if document["file_type"] not in {"pdf", "text", "markdown"}:
            raise HTTPException(status_code=415, detail="Only PDF, TXT, and Markdown documents can be processed.")
        if int(document["file_size_bytes"]) > config.rag_max_document_bytes:
            raise HTTPException(status_code=413, detail="The document exceeds the processing size limit.")

        try:
            await repository.begin_processing(payload.document_id, payload.course_id)
        except RuntimeError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        try:
            file_bytes = await repository.download(
                document["storage_path"],
                payload.document_id,
                payload.course_id,
            )
            pages = await asyncio.to_thread(
                extract_document,
                file_bytes,
                document["file_type"],
                config.rag_max_extracted_characters,
                config.rag_max_pages,
            )
            chunks = chunk_pages(
                pages,
                config.rag_chunk_size,
                config.rag_chunk_overlap,
                config.rag_max_chunks,
            )
            vectors = await embeddings.embed_documents([chunk.content for chunk in chunks])
            await repository.replace_chunks(document, chunks, vectors)
        except ChunkLimitExceeded as error:
            try:
                await repository.set_status(payload.document_id, "failed", course_id=payload.course_id)
            except Exception:
                logger.exception(
                    "document processing failed and status update could not be completed",
                    extra={"document_id": str(payload.document_id)},
                )
            raise HTTPException(status_code=413, detail=str(error)) from error
        except ValueError as error:
            try:
                await repository.set_status(payload.document_id, "failed", course_id=payload.course_id)
            except Exception:
                logger.exception(
                    "document processing failed and status update could not be completed",
                    extra={"document_id": str(payload.document_id)},
                )
            raise HTTPException(status_code=422, detail=str(error)) from error
        except Exception:
            try:
                await repository.set_status(payload.document_id, "failed", course_id=payload.course_id)
            except Exception:
                logger.exception(
                    "document processing failed and status update could not be completed",
                    extra={"document_id": str(payload.document_id)},
                )
            logger.exception(
                "document processing failed",
                extra={"document_id": str(payload.document_id)},
            )
            raise

        return DocumentIngestResponse(
            document_id=payload.document_id,
            status="ready",
            chunks_count=len(chunks),
            embedding_model=config.embedding_model,
        )

    @application.post("/api/v1/rag/search")
    async def rag_search(
        payload: RAGSearchRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        authenticated = await authenticate(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        embeddings = await get_embeddings(request)
        repository = create_rag_repository(authorization, authenticated.id)
        query_vector = await embeddings.embed_query(payload.query)
        results = await repository.search(
            query_vector,
            payload.limit,
            course_id=payload.course_id,
        )
        return {"results": results, "embedding_model": config.embedding_model}

    @application.get("/api/v1/agents/status", response_model=AgentStatusResponse)
    async def agent_status(
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        authenticated = await authenticate(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        rag_available = False
        if (
            config.embedding_enabled
            and config.supabase_is_configured
        ):
            try:
                embeddings = await get_embeddings(request)
                repository = create_rag_repository(authorization, authenticated.id)
                await repository.search([0.0] * embeddings.dimension, limit=1)
                rag_available = True
            except (ForbiddenError, ServiceUnavailableError):
                logger.info("RAG dependencies are not ready for the authenticated user")
        provider_ready = bool(config.provider_is_configured or request.app.state.provider_override)
        supabase_ready = config.supabase_is_configured
        agents = [
            AgentAvailability(
                agent_id="tutor",
                status="available" if provider_ready and supabase_ready else "degraded",
                dependencies=["Supabase Auth", "PostgreSQL", "Groq"],
            ),
            AgentAvailability(
                agent_id="assessment",
                status="available" if provider_ready and supabase_ready else "degraded",
                dependencies=["Supabase Auth", "PostgreSQL", "Groq"],
            ),
            *[
                AgentAvailability(
                    agent_id=agent_id,
                    status="available" if supabase_ready else "degraded",
                    dependencies=["Supabase Auth", "PostgreSQL"],
                )
                for agent_id in (
                    "student_modeling",
                    "knowledge_tracing",
                    "learning_analytics",
                    "knowledge_graph",
                    "recommendation",
                )
            ],
            AgentAvailability(
                agent_id="explainability",
                status="available",
                dependencies=["authenticated request context"],
            ),
        ]
        return AgentStatusResponse(
            agents=agents,
            available=[agent.agent_id for agent in agents if agent.status == "available"],
            unavailable=[agent.agent_id for agent in agents if agent.status != "available"],
            rag_available=rag_available,
        )

    async def execute_coordinated_task(
        payload: AgentExecutionRequest,
        request: Request,
        authorization: str | None,
        background_tasks: BackgroundTasks | None = None,
    ) -> AgentExecutionResponse:
        authenticated = await authenticate(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        provider = create_provider_if_configured(request)
        agents = create_learning_agents(authenticated.id, provider, authorization)
        coordinator = Coordinator(None, agents)
        try:
            workflow = await coordinator.execute(
                payload.task_type,
                course_id=payload.course_id,
                topic=payload.topic,
                topics=payload.topics,
                difficulty=payload.difficulty,
                learning_objectives=payload.learning_objectives,
                question_count=payload.question_count,
                question_format=payload.question_format,
                assessment_id=payload.assessment_id,
                answers=payload.answers,
                time_spent_seconds=payload.time_spent_seconds,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        if payload.task_type == "assessment_evaluate" and background_tasks is not None:
            background_tasks.add_task(
                Coordinator(None, agents).execute,
                "assignment_learning_retry",
                assessment_id=str(payload.assessment_id),
            )
        return AgentExecutionResponse(
            task_type=workflow.task_type,
            data=workflow.data,
            agent_steps=[AgentStep(**step) for step in workflow.agent_steps],
        )

    @application.post("/api/v1/agents/execute", response_model=AgentExecutionResponse)
    async def execute_agent(
        payload: AgentExecutionRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        return await execute_coordinated_task(payload, request, authorization)

    @application.post(
        "/api/v1/agents/personalized-learning",
        response_model=AgentExecutionResponse,
    )
    async def personalized_learning(
        payload: CourseAgentRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        return await execute_coordinated_task(
            AgentExecutionRequest(task_type="personalized_learning", course_id=payload.course_id),
            request,
            authorization,
        )

    @application.get("/api/v1/agents/insights", response_model=AgentExecutionResponse)
    async def learning_insights(
        request: Request,
        course_id: str | None = Query(default=None, min_length=1, max_length=128),
        authorization: str | None = Header(default=None),
    ):
        return await execute_coordinated_task(
            AgentExecutionRequest(task_type="learning_analytics", course_id=course_id),
            request,
            authorization,
        )

    @application.get("/api/v1/agents/recommendations", response_model=AgentExecutionResponse)
    async def learning_recommendations(
        request: Request,
        course_id: str | None = Query(default=None, min_length=1, max_length=128),
        authorization: str | None = Header(default=None),
    ):
        return await execute_coordinated_task(
            AgentExecutionRequest(task_type="recommendations", course_id=course_id),
            request,
            authorization,
        )

    @application.post(
        "/api/v1/agents/assessments",
        response_model=AgentExecutionResponse,
    )
    async def generate_practice_assessment(
        payload: AssessmentGenerateRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        return await execute_coordinated_task(
            AgentExecutionRequest(
                task_type="assessment_generate",
                course_id=payload.course_id,
                topic=payload.topic,
                topics=payload.topics,
                difficulty=payload.difficulty,
                learning_objectives=payload.learning_objectives,
                question_count=payload.question_count,
                question_format=payload.question_format,
            ),
            request,
            authorization,
        )

    @application.post("/api/v1/agents/faculty/assessments")
    async def generate_faculty_assessment_draft(
        payload: FacultyAssessmentGenerateRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        authenticated = await authenticate_faculty(authorization)
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        repository_factory = application.state.learning_repository_factory
        if repository_factory:
            repository = repository_factory(config, authenticated.id)
        else:
            token = authorization.removeprefix("Bearer ").strip()
            repository = SupabaseLearningRepository(config, token, authenticated.id)
        course = await repository.get_faculty_course(payload.course_id)
        provider = create_provider_if_configured(request)
        agents = create_learning_agent_services(provider, config, repository)
        return await agents.assessment.generate_faculty_draft(
            course=course,
            topic=payload.topic,
            difficulty=payload.difficulty,
            question_count=payload.question_count,
            bloom_level=payload.bloom_level,
        )

    @application.post(
        "/api/v1/agents/assessments/{assessment_id}/submit",
        response_model=AgentExecutionResponse,
    )
    async def evaluate_practice_assessment(
        assessment_id: UUID,
        payload: AssessmentSubmissionRequest,
        request: Request,
        background_tasks: BackgroundTasks,
        authorization: str | None = Header(default=None),
    ):
        return await execute_coordinated_task(
            AgentExecutionRequest(
                task_type="assessment_evaluate",
                assessment_id=str(assessment_id),
                answers=payload.answers,
                time_spent_seconds=payload.time_spent_seconds,
            ),
            request,
            authorization,
            background_tasks,
        )

    async def student_assignment_agents(
        authorization: str | None,
    ):
        authenticated = await authenticate(authorization)
        if authenticated.role != "student":
            raise ForbiddenError("Only students can access their practice assignments.")
        if not await limiter.allow(authenticated.id):
            raise HTTPException(status_code=429, detail="AI request limit reached. Please try again shortly.")
        return create_learning_agents(
            authenticated.id,
            None,
            authorization,
        )

    async def execute_student_assignment_learning(
        authorization: str | None,
        task_type: str,
        assessment_id: str | None = None,
    ) -> dict[str, Any]:
        agents = await student_assignment_agents(authorization)
        coordinator = Coordinator(None, agents)
        try:
            workflow = await coordinator.execute(task_type, assessment_id=assessment_id)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return workflow.data

    @application.post("/api/v1/agents/assessments/{assessment_id}/start")
    async def start_practice_assessment(
        assessment_id: UUID,
        authorization: str | None = Header(default=None),
    ):
        agents = await student_assignment_agents(authorization)
        try:
            record = await agents.assessment.start(str(assessment_id))
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return {
            "assessmentId": str(assessment_id),
            "status": record.get("status", "IN_PROGRESS"),
        }

    @application.get("/api/v1/agents/learning/assignments")
    async def assignment_learning_history(
        authorization: str | None = Header(default=None),
    ):
        return await execute_student_assignment_learning(
            authorization,
            "assignment_learning_history",
        )

    @application.get("/api/v1/agents/learning/assignments/{assessment_id}")
    async def assignment_learning_detail(
        assessment_id: UUID,
        authorization: str | None = Header(default=None),
    ):
        return await execute_student_assignment_learning(
            authorization,
            "assignment_learning_detail",
            str(assessment_id),
        )

    @application.post("/api/v1/agents/learning/assignments/{assessment_id}/retry-analysis")
    async def retry_assignment_learning_analysis(
        assessment_id: UUID,
        authorization: str | None = Header(default=None),
    ):
        return await execute_student_assignment_learning(
            authorization,
            "assignment_learning_retry",
            str(assessment_id),
        )

    return application


def _error_response(status_code: int, detail: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status_code, content={"detail": detail})


app = create_app()
