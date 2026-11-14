import asyncio
import threading
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np

from ai_service.app.config import Settings
from ai_service.app.errors import ServiceUnavailableError


class SentenceTransformerEmbeddings:
    def __init__(
        self,
        settings: Settings,
        model_loader: Callable[..., Any] | None = None,
    ) -> None:
        self.model_name = settings.embedding_model
        self.dimension = settings.embedding_dimension
        self._model_loader = model_loader
        self._model: Any | None = None
        self._load_lock = asyncio.Lock()
        self._thread_lock = threading.Lock()

    def _load_model(self) -> None:
        with self._thread_lock:
            if self._model is not None:
                return
            try:
                if self._model_loader:
                    self._model = self._model_loader(self.model_name)
                else:
                    from sentence_transformers import SentenceTransformer

                    self._model = SentenceTransformer(self.model_name)
                dimension_getter = getattr(self._model, "get_embedding_dimension", None)
                if not callable(dimension_getter):
                    dimension_getter = self._model.get_sentence_embedding_dimension
                actual_dimension = dimension_getter()
                if actual_dimension != self.dimension:
                    self._model = None
                    raise ServiceUnavailableError(
                        f"Embedding model dimension {actual_dimension} does not match configured dimension {self.dimension}."
                    )
            except ServiceUnavailableError:
                raise
            except (ImportError, OSError, RuntimeError, ValueError) as error:
                raise ServiceUnavailableError(
                    f"Embedding model '{self.model_name}' could not be initialized."
                ) from error

    async def load(self) -> None:
        async with self._load_lock:
            await asyncio.to_thread(self._load_model)

    def _encode(self, texts: Sequence[str], method: str) -> list[list[float]]:
        if not texts or any(not isinstance(text, str) or not text.strip() for text in texts):
            raise ValueError("Embedding input must contain non-empty text.")
        self._load_model()
        encoder = getattr(self._model, method, None)
        if not callable(encoder):
            encoder = self._model.encode
        vectors = encoder(
            list(texts),
            batch_size=32,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim == 1:
            matrix = matrix.reshape(1, -1)
        if matrix.shape != (len(texts), self.dimension):
            raise ServiceUnavailableError("The embedding model returned vectors with an invalid dimension.")
        if not np.isfinite(matrix).all():
            raise ServiceUnavailableError("The embedding model returned non-finite vector values.")
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise ServiceUnavailableError("The embedding model returned a zero-length vector.")
        matrix /= norms
        return matrix.tolist()

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return await asyncio.to_thread(self._encode, texts, "encode_document")

    async def embed_query(self, text: str) -> list[float]:
        vectors = await asyncio.to_thread(self._encode, [text], "encode_query")
        return vectors[0]

    async def close(self) -> None:
        def release_model() -> None:
            with self._thread_lock:
                self._model = None

        await asyncio.to_thread(release_model)
