import httpx
import pytest
from pydantic import SecretStr

from ai_service.app.config import Settings
from ai_service.app.errors import ProviderError, ProviderRateLimitError, ServiceUnavailableError
from ai_service.app.providers.groq import GroqProvider


def settings(**overrides):
    return Settings(_env_file=None, **overrides)


@pytest.mark.asyncio
async def test_groq_adapter_maps_chat_completion_and_usage():
    def handler(request):
        assert request.url.path == "/openai/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer private-test-key"
        assert request.read()
        return httpx.Response(200, json={
            "model": "test-model",
            "choices": [{"message": {"content": "A real adapter response."}}],
            "usage": {"prompt_tokens": 15, "completion_tokens": 6},
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GroqProvider(settings(groq_api_key=SecretStr("private-test-key")), client)
    result = await provider.generate([{"role": "user", "content": "Explain recursion."}], 80)
    await client.aclose()

    assert result.text == "A real adapter response."
    assert result.input_tokens == 15
    assert result.output_tokens == 6


@pytest.mark.asyncio
async def test_provider_rejects_missing_api_key_without_network_request():
    provider = GroqProvider(settings())

    with pytest.raises(ServiceUnavailableError, match="GROQ_API_KEY"):
        await provider.generate([{"role": "user", "content": "Question"}], 50)


@pytest.mark.asyncio
async def test_provider_does_not_expose_vendor_error_body():
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(429, text="private vendor diagnostic")),
    )
    provider = GroqProvider(settings(groq_api_key=SecretStr("test")), client)
    with pytest.raises(ProviderRateLimitError, match="rate limited") as error:
        await provider.generate([{"role": "user", "content": "Question"}], 50)
    assert "private vendor diagnostic" not in str(error.value)
    await client.aclose()


@pytest.mark.asyncio
async def test_groq_retries_rate_limit_only_after_server_delay(monkeypatch):
    calls = []
    delays = []

    async def sleep(delay):
        delays.append(delay)

    def handler(_request):
        calls.append(True)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={
            "model": "test-model",
            "choices": [{"message": {"content": "Recovered response."}}],
            "usage": {},
        })

    monkeypatch.setattr("ai_service.app.providers.groq.asyncio.sleep", sleep)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await GroqProvider(settings(groq_api_key=SecretStr("test")), client).generate(
        [{"role": "user", "content": "Question"}],
        50,
    )
    await client.aclose()

    assert result.text == "Recovered response."
    assert len(calls) == 2
    assert delays == [0]


@pytest.mark.asyncio
async def test_groq_does_not_retry_beyond_its_safe_retry_window():
    calls = []

    def handler(_request):
        calls.append(True)
        return httpx.Response(429, headers={"Retry-After": "30"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GroqProvider(settings(groq_api_key=SecretStr("test")), client)
    with pytest.raises(ProviderRateLimitError) as error:
        await provider.generate([{"role": "user", "content": "Question"}], 50)
    assert error.value.retry_after == 30
    assert len(calls) == 1
    await client.aclose()


@pytest.mark.asyncio
async def test_groq_retries_transient_server_errors_a_bounded_number_of_times(monkeypatch):
    calls = []

    async def sleep(_delay):
        return None

    def handler(_request):
        calls.append(True)
        if len(calls) < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={
            "model": "test-model",
            "choices": [{"message": {"content": "Recovered response."}}],
            "usage": {},
        })

    monkeypatch.setattr("ai_service.app.providers.groq.asyncio.sleep", sleep)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await GroqProvider(settings(groq_api_key=SecretStr("test")), client).generate(
        [{"role": "user", "content": "Question"}],
        50,
    )
    await client.aclose()

    assert result.text == "Recovered response."
    assert len(calls) == 3
