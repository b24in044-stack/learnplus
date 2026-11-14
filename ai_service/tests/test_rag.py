import io
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from pypdf import PdfWriter
from storage3.exceptions import StorageException

from ai_service.app.config import Settings
from ai_service.app.errors import ForbiddenError, ServiceUnavailableError
from ai_service.app.rag import (
    ChunkLimitExceeded,
    DocumentChunk,
    DocumentPage,
    SupabaseRAGRepository,
    chunk_pages,
    extract_document,
)


def test_text_extraction_normalizes_and_rejects_empty_or_non_utf8_text():
    assert extract_document(b"  First page\n\nNotes. ", "text", 100)[0].content == "First page\n\nNotes."
    with pytest.raises(ValueError, match="No readable text"):
        extract_document(b" \n ", "markdown", 100)
    with pytest.raises(ValueError, match="valid UTF-8"):
        extract_document(b"\xff", "text", 100)
    with pytest.raises(ValueError, match="Only PDF"):
        extract_document(b"binary", "docx", 100)


def test_text_extraction_enforces_extracted_character_limit():
    with pytest.raises(ValueError, match="processing limit"):
        extract_document(b"word " * 20, "text", 20)


def test_pdf_extraction_rejects_page_count_over_limit_before_extracting_pages():
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_blank_page(width=72, height=72)
    pdf_buffer = io.BytesIO()
    writer.write(pdf_buffer)
    with pytest.raises(ValueError, match="maximum of 1 pages"):
        extract_document(pdf_buffer.getvalue(), "pdf", 100, max_pages=1)


def test_chunking_preserves_page_source_and_overlap():
    pages = [DocumentPage(1, "one two three four five six"), DocumentPage(2, "seven eight nine")]
    chunks = chunk_pages(pages, chunk_size=4, overlap=1)
    assert [chunk.page_number for chunk in chunks] == [1, 1, 2]
    assert [chunk.chunk_index for chunk in chunks] == [0, 1, 2]
    assert chunks[0].content.endswith("four")
    assert chunks[1].content.startswith("four")
    assert chunks[2].content == "seven eight nine"


def test_chunking_does_not_duplicate_overlap_at_page_boundary():
    chunks = chunk_pages([DocumentPage(1, "one two three four")], chunk_size=4, overlap=1)
    assert len(chunks) == 1
    assert chunks[0].content == "one two three four"


def test_chunk_parameters_are_validated():
    with pytest.raises(ValueError, match="overlap"):
        chunk_pages([DocumentPage(None, "words")], chunk_size=10, overlap=10)


def test_chunking_rejects_batches_over_configured_limit_before_building_chunks():
    with pytest.raises(ChunkLimitExceeded, match="maximum of 2 chunks"):
        chunk_pages([DocumentPage(None, "word " * 1000)], chunk_size=100, overlap=99, max_chunks=2)


@pytest.mark.parametrize("word_count", [1999, 2000])
def test_chunking_accepts_exact_chunk_boundary(word_count):
    chunks = chunk_pages(
        [DocumentPage(None, "word " * word_count)],
        chunk_size=1,
        overlap=0,
        max_chunks=2000,
    )
    assert len(chunks) == word_count


def test_chunking_rejects_chunk_limit_plus_one():
    with pytest.raises(ChunkLimitExceeded, match="maximum of 2000 chunks"):
        chunk_pages([DocumentPage(None, "word " * 2001)], chunk_size=1, overlap=0, max_chunks=2000)


def test_chunking_preflights_small_stride_large_document():
    with pytest.raises(ChunkLimitExceeded, match="maximum of 2000 chunks"):
        chunk_pages([DocumentPage(None, "word " * 50_000)], chunk_size=100, overlap=99, max_chunks=2000)


class FakeQuery:
    def __init__(self, client, table):
        self.client = client
        self.table_name = table
        self.filters = {}
        self.in_filters = {}
        self.single = False
        self.inserted = None

    def select(self, _fields):
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def in_(self, field, values):
        self.in_filters[field] = set(values)
        return self

    def maybe_single(self):
        self.single = True
        return self

    def insert(self, rows):
        self.inserted = rows
        self.client.insertions.append((self.table_name, rows))
        return self

    def execute(self):
        if self.inserted is not None:
            return SimpleNamespace(data=self.inserted)
        rows = self.client.tables.get(self.table_name, [])
        if isinstance(rows, dict):
            rows = [rows]
        rows = [
            row for row in rows
            if all(row.get(field) == value for field, value in self.filters.items())
            and all(row.get(field) in values for field, values in self.in_filters.items())
        ]
        if self.single:
            return SimpleNamespace(data=rows[0] if rows else None)
        return SimpleNamespace(data=rows)


class FakeRPC:
    def __init__(self, client, name, parameters):
        self.client = client
        self.name = name
        self.parameters = parameters

    def execute(self):
        self.client.rpc_calls.append((self.name, self.parameters))
        if self.name in self.client.rpc_errors:
            raise self.client.rpc_errors[self.name]
        return SimpleNamespace(data=self.client.rpc_results.get(self.name))


class FakeStorageBucket:
    def __init__(self, client):
        self.client = client

    def download(self, path):
        if self.client.storage_error:
            raise self.client.storage_error
        assert path == self.client.document["object_path"]
        return self.client.file_bytes


class FakeStorage:
    def __init__(self, client):
        self.client = client

    def from_(self, bucket_id):
        assert bucket_id == self.client.document["bucket_id"]
        return FakeStorageBucket(self.client)


class FakeSupabase:
    def __init__(self, user_id="student-uid"):
        document_id = uuid4()
        self.document = {
            "id": str(document_id),
            "owner_id": user_id,
            "course_id": None,
            "title": "Notes",
            "status": "uploaded",
            "file_type": "text",
            "file_size_bytes": 100,
            "bucket_id": "student-documents",
            "object_path": f"users/{user_id}/documents/notes.txt",
            "metadata": {},
            "processing_generation": None,
        }
        self.tables = {
            "documents": [self.document],
            "document_chunks": [],
        }
        self.rpc_results = {
            "begin_document_processing": "generation-1",
            "match_document_chunks": [],
            "complete_document_processing": None,
            "fail_document_processing": None,
        }
        self.rpc_errors = {}
        self.rpc_calls = []
        self.insertions = []
        self.storage = FakeStorage(self)
        self.file_bytes = b"Some readable document text."
        self.storage_error = None

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, parameters):
        return FakeRPC(self, name, parameters)


def make_repository(client):
    return SupabaseRAGRepository(Settings(_env_file=None), "access-token", "student-uid", client=client)


@pytest.mark.asyncio
async def test_supabase_vector_search_returns_only_rpc_authorized_results():
    client = FakeSupabase()
    document_id = client.document["id"]
    client.rpc_results["match_document_chunks"] = [{
        "chunk_id": str(uuid4()),
        "document_id": document_id,
        "chunk_index": 1,
        "page_number": 3,
        "content": "Relevant course text",
        "similarity": 0.8,
    }]
    repository = make_repository(client)

    results = await repository.search([0.0] * 384, limit=3)

    assert len(results) == 1
    assert results[0]["document_id"] == document_id
    assert results[0]["document_title"] == "Notes"
    assert results[0]["page_number"] == 3
    assert results[0]["similarity"] == pytest.approx(0.8)
    assert client.rpc_calls[0][0] == "match_document_chunks"


@pytest.mark.asyncio
async def test_supabase_course_search_passes_course_scope_to_authorized_rpc():
    client = FakeSupabase()
    client.rpc_results["match_document_chunks"] = []

    await make_repository(client).search([0.0] * 384, limit=3, course_id="course-1")

    assert client.rpc_calls[0][1]["target_course_id"] == "course-1"


@pytest.mark.asyncio
async def test_supabase_search_rejects_unauthorized_course_access():
    from postgrest.exceptions import APIError

    client = FakeSupabase()
    client.rpc_errors["match_document_chunks"] = APIError({
        "message": "Access denied",
        "code": "42501",
        "details": None,
        "hint": None,
    })

    with pytest.raises(ForbiddenError):
        await make_repository(client).search([0.0] * 384, course_id="foreign-course")


@pytest.mark.asyncio
async def test_supabase_document_download_uses_authorized_private_bucket():
    client = FakeSupabase()
    document_id = UUID(client.document["id"])

    result = await make_repository(client).download(
        client.document["object_path"],
        document_id,
    )

    assert result == client.file_bytes


@pytest.mark.asyncio
async def test_supabase_document_ingestion_uses_generation_rpcs_and_vector_rows():
    client = FakeSupabase()
    repository = make_repository(client)
    document_id = UUID(client.document["id"])
    document = await repository.get_document(document_id)
    await repository.begin_processing(document_id)

    await repository.replace_chunks(
        document,
        [DocumentChunk(0, None, "Relevant text")],
        [[0.0] * 384],
    )

    assert client.insertions[0][0] == "document_chunks"
    assert client.insertions[0][1][0]["generation_id"] == "generation-1"
    assert client.rpc_calls[-1][0] == "complete_document_processing"


@pytest.mark.asyncio
async def test_supabase_ingestion_failure_marks_generation_failed():
    client = FakeSupabase()
    repository = make_repository(client)
    document_id = UUID(client.document["id"])
    await repository.begin_processing(document_id)

    await repository.set_status(document_id, "failed")

    assert client.rpc_calls[-1] == (
        "fail_document_processing",
        {
            "target_document_id": str(document_id),
            "target_generation": "generation-1",
            "safe_error_code": "processing_failed",
        },
    )


@pytest.mark.asyncio
async def test_supabase_storage_failure_is_reported_as_unavailable():
    client = FakeSupabase()
    client.storage_error = StorageException("storage unavailable")

    with pytest.raises(ServiceUnavailableError, match="Supabase Storage"):
        await make_repository(client).download(
            client.document["object_path"],
            UUID(client.document["id"]),
        )


@pytest.mark.asyncio
async def test_supabase_chunk_write_rejects_invalid_embedding_before_database_access():
    client = FakeSupabase()
    repository = make_repository(client)
    document_id = UUID(client.document["id"])
    document = await repository.get_document(document_id)
    await repository.begin_processing(document_id)

    with pytest.raises(ValueError, match="Embedding values"):
        await repository.replace_chunks(
            document,
            [DocumentChunk(0, None, "text")],
            [[0.0] * 383],
        )

    assert client.insertions == []
