import numpy as np
import pytest

from ai_service.app.config import Settings
from ai_service.app.embeddings import SentenceTransformerEmbeddings
from ai_service.app.errors import ServiceUnavailableError


class FakeModel:
    def __init__(self, dimension=384):
        self.dimension = dimension
        self.document_calls = 0
        self.query_calls = 0

    def get_sentence_embedding_dimension(self):
        return self.dimension

    def encode_document(self, texts, **_kwargs):
        self.document_calls += 1
        return np.tile(np.array([[3.0, 4.0] + [0.0] * 382]), (len(texts), 1))

    def encode_query(self, texts, **_kwargs):
        self.query_calls += 1
        return np.tile(np.array([[0.0, 2.0] + [0.0] * 382]), (len(texts), 1))


@pytest.mark.asyncio
async def test_embeddings_load_once_normalize_and_use_document_query_encoders():
    model = FakeModel()
    loads = []
    provider = SentenceTransformerEmbeddings(
        Settings(_env_file=None),
        model_loader=lambda name: loads.append(name) or model,
    )

    documents = await provider.embed_documents(["first passage", "second passage"])
    query = await provider.embed_query("a question")

    assert loads == ["sentence-transformers/all-MiniLM-L6-v2"]
    assert model.document_calls == 1
    assert model.query_calls == 1
    assert len(documents) == 2
    assert all(len(vector) == 384 for vector in documents + [query])
    assert documents[0][:2] == pytest.approx([0.6, 0.8])
    assert query[:2] == pytest.approx([0.0, 1.0])


@pytest.mark.asyncio
async def test_embedding_dimension_and_input_are_validated():
    provider = SentenceTransformerEmbeddings(
        Settings(_env_file=None),
        model_loader=lambda _name: FakeModel(dimension=3),
    )
    with pytest.raises(ServiceUnavailableError, match="does not match"):
        await provider.load()

    with pytest.raises(ValueError, match="non-empty"):
        await provider.embed_documents(["   "])


@pytest.mark.asyncio
async def test_model_initialization_failure_is_explicit():
    provider = SentenceTransformerEmbeddings(
        Settings(_env_file=None),
        model_loader=lambda _name: (_ for _ in ()).throw(OSError("model unavailable")),
    )
    with pytest.raises(ServiceUnavailableError, match="could not be initialized"):
        await provider.load()
