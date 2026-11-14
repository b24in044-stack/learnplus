import asyncio
import io
import math
import re
import unicodedata
from dataclasses import dataclass
from itertools import islice
from typing import Any
from uuid import UUID, uuid5, NAMESPACE_URL

import httpx
from postgrest.exceptions import APIError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from storage3.exceptions import StorageException

from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError
from ai_service.app.supabase_client import create_user_supabase_client


@dataclass(frozen=True)
class DocumentPage:
    page_number: int | None
    content: str


@dataclass(frozen=True)
class DocumentChunk:
    chunk_index: int
    page_number: int | None
    content: str


class ChunkLimitExceeded(ValueError):
    pass


def extract_document(
    data: bytes,
    file_type: str,
    max_characters: int,
    max_pages: int = 1000,
) -> list[DocumentPage]:
    if not data:
        raise ValueError("The uploaded document is empty.")
    if max_characters <= 0 or max_pages <= 0:
        raise ValueError("Document processing limits must be positive.")
    if file_type == "pdf":
        try:
            reader = PdfReader(io.BytesIO(data), strict=True)
            if reader.is_encrypted:
                raise ValueError("Encrypted PDF files are not supported.")
            if len(reader.pages) > max_pages:
                raise ValueError(f"The PDF exceeds the maximum of {max_pages} pages.")
            pages = []
            total_characters = 0
            for index, page in enumerate(reader.pages):
                content = _normalize_text(page.extract_text() or "")
                total_characters += len(content)
                if total_characters > max_characters:
                    raise ValueError("Extracted document text exceeds the processing limit.")
                if content:
                    pages.append(DocumentPage(index + 1, content))
        except ValueError:
            raise
        except (PdfReadError, OSError, TypeError) as error:
            raise ValueError("The PDF could not be read.") from error
    elif file_type in {"text", "markdown"}:
        try:
            text = data.decode("utf-8-sig", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("Text and Markdown files must be valid UTF-8.") from error
        if "\x00" in text:
            raise ValueError("Binary data is not valid text.")
        pages = [DocumentPage(None, _normalize_text(text))]
    else:
        raise ValueError("Only PDF, TXT, and Markdown documents can be processed.")

    nonempty = [page for page in pages if page.content]
    if not nonempty:
        raise ValueError("No readable text was found in the document.")
    if file_type in {"text", "markdown"} and len(nonempty[0].content) > max_characters:
        raise ValueError("Extracted document text exceeds the processing limit.")
    return nonempty


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[^\S\n]+", " ", line).strip() for line in normalized.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def chunk_pages(
    pages: list[DocumentPage],
    chunk_size: int,
    overlap: int,
    max_chunks: int = 2000,
) -> list[DocumentChunk]:
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("Chunk size must be positive and overlap must be smaller than chunk size.")
    if max_chunks <= 0:
        raise ValueError("Maximum chunk count must be positive.")
    stride = chunk_size - overlap
    projected_count = sum(
        _chunk_count(sum(1 for _ in re.finditer(r"\S+", page.content)), chunk_size, stride)
        for page in pages
    )
    if projected_count > max_chunks:
        raise ChunkLimitExceeded(f"The document would exceed the maximum of {max_chunks} chunks.")

    chunks: list[DocumentChunk] = []
    for page in pages:
        words = iter(re.finditer(r"\S+", page.content))
        window = list(islice(words, chunk_size))
        if not window:
            continue
        while window:
            chunk_text = page.content[window[0].start():window[-1].end()].strip()
            chunks.append(DocumentChunk(len(chunks), page.page_number, chunk_text))
            if len(window) < chunk_size:
                break
            retained = window[-overlap:] if overlap else []
            following = list(islice(words, stride))
            if not following:
                break
            window = retained + following
    return chunks


def _chunk_count(word_count: int, chunk_size: int, stride: int) -> int:
    if word_count <= 0:
        return 0
    return (max(0, word_count - chunk_size) + stride - 1) // stride + 1


class SupabaseRAGRepository:
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
        self._processing_generations: dict[str, str] = {}

    def _supabase(self):
        return self._client or create_user_supabase_client(self._settings, self._access_token)

    @staticmethod
    def _raise_data_error(error: Exception, message: str) -> None:
        if isinstance(error, APIError) and getattr(error, "code", None) == "42501":
            raise ForbiddenError("The authenticated account cannot access this resource.") from error
        if isinstance(error, APIError) and getattr(error, "code", None) == "55000":
            raise RuntimeError("The document is already being processed or is not retryable.") from error
        if isinstance(error, (APIError, httpx.HTTPError, StorageException)):
            raise ServiceUnavailableError(message) from error
        raise error

    def _accessible_document(
        self,
        document_id: UUID,
        course_id: str | None = None,
    ) -> dict[str, Any]:
        response = (
            self._supabase()
            .table("documents")
            .select("*")
            .eq("id", str(document_id))
            .maybe_single()
            .execute()
        )
        document = response.data
        if not isinstance(document, dict):
            raise LookupError("Document was not found or is not accessible.")
        if course_id and str(document.get("course_id")) != course_id:
            raise LookupError("Document was not found or is not accessible.")
        return document

    async def get_document(
        self,
        document_id: UUID,
        course_id: str | None = None,
    ) -> dict[str, Any]:
        try:
            document = await asyncio.to_thread(self._accessible_document, document_id, course_id)
            return {
                **document,
                "id": str(document_id),
                "owner_id": document.get("owner_id"),
                "course_id": document.get("course_id"),
                "storage_path": document.get("object_path"),
                "bucket_id": document.get("bucket_id"),
                "file_type": document.get("file_type"),
                "file_size_bytes": document.get("file_size_bytes", 0),
                "metadata": document.get("metadata", {}),
            }
        except LookupError:
            raise
        except Exception as error:
            self._raise_data_error(error, "Supabase document metadata is unavailable.")

    def _begin_processing(self, document_id: UUID, course_id: str | None = None) -> None:
        document = self._accessible_document(document_id, course_id)
        if str(document.get("status", "")).lower() not in {"uploaded", "failed", "ready"}:
            raise RuntimeError("The document is already being processed or is not retryable.")
        response = self._supabase().rpc(
            "begin_document_processing",
            {"target_document_id": str(document_id)},
        ).execute()
        generation = response.data
        if not isinstance(generation, str) or not generation:
            raise ServiceUnavailableError("Supabase did not start a document processing generation.")
        self._processing_generations[str(document_id)] = generation

    async def begin_processing(self, document_id: UUID, course_id: str | None = None) -> None:
        try:
            await asyncio.to_thread(self._begin_processing, document_id, course_id)
        except (RuntimeError, ForbiddenError):
            raise
        except Exception as error:
            self._raise_data_error(error, "The document processing state could not be initialized.")

    def _download(
        self,
        storage_path: str,
        document_id: UUID | None = None,
        course_id: str | None = None,
    ) -> bytes:
        if document_id is None:
            raise ValueError("A document ID is required for authorized document downloads.")
        document = self._accessible_document(document_id, course_id)
        if document.get("object_path") != storage_path:
            raise ForbiddenError("The authenticated account cannot access this document.")
        bucket_id = document.get("bucket_id")
        if not isinstance(bucket_id, str) or not bucket_id:
            raise ValueError("The document has no configured storage bucket.")
        data = self._supabase().storage.from_(bucket_id).download(storage_path)
        if not isinstance(data, bytes):
            raise ServiceUnavailableError("Supabase Storage returned an invalid document response.")
        if not data or len(data) > self._settings.rag_max_document_bytes:
            raise ValueError("The stored document is empty or exceeds the processing size limit.")
        return data

    async def download(
        self,
        storage_path: str,
        document_id: UUID | None = None,
        course_id: str | None = None,
    ) -> bytes:
        try:
            return await asyncio.to_thread(self._download, storage_path, document_id, course_id)
        except (ForbiddenError, ValueError):
            raise
        except Exception as error:
            self._raise_data_error(error, "Supabase Storage document download failed.")

    def _replace_chunks(
        self,
        document: dict[str, Any],
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
    ) -> None:
        if len(chunks) != len(vectors):
            raise ValueError("Embedding count does not match document chunk count.")
        if len(chunks) > self._settings.rag_max_chunks:
            raise ChunkLimitExceeded(f"The document exceeds the maximum of {self._settings.rag_max_chunks} chunks.")
        if any(
            len(vector) != self._settings.embedding_dimension
            or any(not math.isfinite(value) for value in vector)
            for vector in vectors
        ):
            raise ValueError("Embedding values do not match the configured model.")

        document_id = str(document["id"])
        generation = self._processing_generations.get(document_id)
        if not generation:
            raise RuntimeError("The document processing generation is no longer active.")

        client = self._supabase()
        for offset in range(0, len(chunks), 200):
            batch = chunks[offset:offset + 200]
            vector_batch = vectors[offset:offset + 200]
            rows = []
            for chunk, vector in zip(batch, vector_batch):
                chunk_id = uuid5(
                    NAMESPACE_URL,
                    f"student-agent-ai:{document_id}:{generation}:{chunk.chunk_index}",
                )
                rows.append({
                    "id": str(chunk_id),
                    "document_id": document_id,
                    "course_id": document.get("course_id"),
                    "generation_id": generation,
                    "chunk_index": chunk.chunk_index,
                    "page_number": chunk.page_number,
                    "content": chunk.content,
                    "embedding_model": self._settings.embedding_model,
                    "embedding": vector,
                    "metadata": {},
                })
            client.table("document_chunks").insert(rows).execute()

        client.rpc(
            "complete_document_processing",
            {
                "target_document_id": document_id,
                "target_generation": generation,
                "expected_chunk_count": len(chunks),
                "target_embedding_model": self._settings.embedding_model,
            },
        ).execute()
        self._processing_generations.pop(document_id, None)

    async def replace_chunks(
        self,
        document: dict[str, Any],
        chunks: list[DocumentChunk],
        vectors: list[list[float]],
    ) -> None:
        try:
            await asyncio.to_thread(self._replace_chunks, document, chunks, vectors)
        except (ChunkLimitExceeded, RuntimeError, ValueError, ForbiddenError, ServiceUnavailableError):
            raise
        except Exception as error:
            self._raise_data_error(error, "The document chunks could not be stored in Supabase.")

    def _set_status(
        self,
        document_id: UUID,
        status: str,
        metadata: dict[str, Any] | None,
        course_id: str | None = None,
    ) -> None:
        del metadata
        if status != "failed":
            raise ValueError("Only failed document processing status can be set directly.")
        self._accessible_document(document_id, course_id)
        generation = self._processing_generations.get(str(document_id))
        if not generation:
            raise RuntimeError("The document processing generation is no longer active.")
        self._supabase().rpc(
            "fail_document_processing",
            {
                "target_document_id": str(document_id),
                "target_generation": generation,
                "safe_error_code": "processing_failed",
            },
        ).execute()
        self._processing_generations.pop(str(document_id), None)

    async def set_status(
        self,
        document_id: UUID,
        status: str,
        metadata: dict[str, Any] | None = None,
        course_id: str | None = None,
    ) -> None:
        try:
            await asyncio.to_thread(self._set_status, document_id, status, metadata, course_id)
        except (ValueError, RuntimeError, ForbiddenError):
            raise
        except Exception as error:
            self._raise_data_error(error, "The document processing status could not be updated.")

    def _search(
        self,
        query_vector: list[float],
        limit: int,
        course_id: str | None = None,
    ) -> list[dict[str, Any]]:
        if len(query_vector) != self._settings.embedding_dimension or any(
            not math.isfinite(value) for value in query_vector
        ):
            raise ValueError("The query embedding values do not match the configured model.")
        if limit < 1 or limit > 50:
            raise ValueError("The retrieval result limit must be between 1 and 50.")

        response = self._supabase().rpc(
            "match_document_chunks",
            {
                "query_embedding": query_vector,
                "result_limit": limit,
                "target_course_id": course_id,
                "target_embedding_model": self._settings.embedding_model,
            },
        ).execute()
        matches = response.data if isinstance(response.data, list) else []
        document_ids = list({
            str(item["document_id"])
            for item in matches
            if isinstance(item, dict) and item.get("document_id")
        })
        titles: dict[str, str] = {}
        if document_ids:
            documents = (
                self._supabase()
                .table("documents")
                .select("id, title")
                .in_("id", document_ids)
                .execute()
                .data
            )
            if isinstance(documents, list):
                titles = {
                    str(item["id"]): str(item.get("title") or "Document")
                    for item in documents
                    if isinstance(item, dict) and item.get("id")
                }

        results = []
        for item in matches:
            if not isinstance(item, dict) or str(item.get("document_id")) not in titles:
                continue
            results.append({
                "chunk_id": str(item["chunk_id"]),
                "document_id": str(item["document_id"]),
                "document_title": titles[str(item["document_id"])][:200],
                "page_number": item.get("page_number"),
                "chunk_index": item.get("chunk_index"),
                "content": item.get("content", ""),
                "similarity": float(item.get("similarity", 0)),
            })
        return results

    async def search(
        self,
        query_vector: list[float],
        limit: int = 5,
        course_id: str | None = None,
    ) -> list[dict[str, Any]]:
        try:
            return await asyncio.to_thread(self._search, query_vector, limit, course_id)
        except (ForbiddenError, ValueError):
            raise
        except Exception as error:
            self._raise_data_error(
                error,
                "Supabase vector retrieval is unavailable. Verify pgvector and the configured 384-dimensional index.",
            )
