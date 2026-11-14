import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx
from groq import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncGroq,
    RateLimitError,
)

from ai_service.app.config import Settings
from ai_service.app.errors import ProviderError, ProviderRateLimitError, ServiceUnavailableError
from ai_service.app.providers.base import Generation


class GroqProvider:
    name = "groq"
    max_attempts = 3
    max_retry_after_seconds = 5.0

    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient | AsyncGroq | None = None,
    ) -> None:
        self._settings = settings
        self.model = settings.groq_model
        self._client = client

    def _api_key(self) -> str:
        if not self._settings.groq_api_key or not self._settings.groq_api_key.get_secret_value().strip():
            raise ServiceUnavailableError("The configured Groq provider is missing GROQ_API_KEY.")
        return self._settings.groq_api_key.get_secret_value()

    def _create_client(self) -> tuple[AsyncGroq, bool]:
        if isinstance(self._client, AsyncGroq):
            return self._client, False
        if isinstance(self._client, httpx.AsyncClient):
            return (
                AsyncGroq(
                    api_key=self._api_key(),
                    http_client=self._client,
                    timeout=self._settings.provider_timeout_seconds,
                    max_retries=0,
                ),
                False,
            )
        return (
            AsyncGroq(
                api_key=self._api_key(),
                timeout=self._settings.provider_timeout_seconds,
                max_retries=0,
            ),
            True,
        )

    async def _request(self, messages: list[dict[str, str]], max_tokens: int):
        client, owns_client = self._create_client()
        try:
            for attempt in range(self.max_attempts):
                try:
                    return await client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=0.4,
                    )
                except RateLimitError as error:
                    retry_after = self._retry_after(error.response.headers.get("retry-after"))
                    if attempt + 1 == self.max_attempts or retry_after > self.max_retry_after_seconds:
                        raise ProviderRateLimitError(
                            "Groq rate limited the request. Please retry after the indicated delay.",
                            retry_after,
                        ) from error
                    await asyncio.sleep(retry_after)
                except APIStatusError as error:
                    if error.status_code in {500, 502, 503, 504} and attempt + 1 < self.max_attempts:
                        await asyncio.sleep(0.25 * (2 ** attempt))
                        continue
                    raise ProviderError(f"Groq provider returned HTTP {error.status_code}.") from error
                except (APITimeoutError, APIConnectionError) as error:
                    raise ServiceUnavailableError("The configured Groq provider could not be reached.") from error
            raise ProviderError("Groq provider could not complete the request after bounded retries.")
        finally:
            if owns_client:
                await client.close()

    @staticmethod
    def _retry_after(value: str | None) -> float:
        if not value:
            return 1.0
        try:
            return max(0.0, float(value))
        except ValueError:
            try:
                retry_time = parsedate_to_datetime(value)
                if retry_time.tzinfo is None:
                    retry_time = retry_time.replace(tzinfo=timezone.utc)
                return max(0.0, (retry_time - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError, OverflowError):
                return 1.0

    async def generate(self, messages: list[dict[str, str]], max_tokens: int) -> Generation:
        try:
            completion = await self._request(messages, max_tokens)
            text = completion.choices[0].message.content
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty content")
            usage = completion.usage
            return Generation(
                text=text.strip(),
                input_tokens=usage.prompt_tokens if usage else 0,
                output_tokens=usage.completion_tokens if usage else 0,
                model=completion.model or self.model,
            )
        except (IndexError, TypeError, ValueError) as error:
            raise ProviderError("Groq provider returned an invalid response.") from error

    async def health_check(self) -> bool:
        client, owns_client = self._create_client()
        try:
            await client.models.list()
            return True
        except RateLimitError as error:
            retry_after = self._retry_after(error.response.headers.get("retry-after"))
            raise ProviderRateLimitError(
                "Groq rate limited the provider health check.",
                retry_after,
            ) from error
        except APIStatusError as error:
            raise ProviderError(f"Groq provider returned HTTP {error.status_code}.") from error
        except (APITimeoutError, APIConnectionError) as error:
            raise ServiceUnavailableError("The configured Groq provider could not be reached.") from error
        finally:
            if owns_client:
                await client.close()
