import pytest

from ai_service.app.coordinator import Coordinator
from ai_service.app.errors import UnsupportedIntentError


class FakeTutor:
    async def answer(self, history, question, sources=None):
        assert history[-1]["content"] == "Earlier question"
        assert question == "Explain recursion with an example."
        return "Recursion is when a function calls itself.", {
            "provider": "unit-test",
            "model": "fake-model",
            "input_tokens": 20,
            "output_tokens": 12,
        }


@pytest.mark.asyncio
async def test_coordinator_routes_academic_question_to_tutor():
    result = await Coordinator(FakeTutor()).handle(
        [{"role": "user", "content": "Earlier question"}],
        "Explain recursion with an example.",
    )

    assert result.intent == "tutoring"
    assert result.provider == "unit-test"
    assert result.content.startswith("Recursion")
    assert result.tutor_duration_ms >= 0


@pytest.mark.asyncio
async def test_coordinator_does_not_fake_unimplemented_assessment_agent():
    with pytest.raises(UnsupportedIntentError, match="Assessment generation"):
        await Coordinator(FakeTutor()).handle([], "Generate a quiz with five questions.")


@pytest.mark.asyncio
async def test_coordinator_does_not_fake_unimplemented_analytics_agent():
    with pytest.raises(UnsupportedIntentError, match="Learning analytics"):
        await Coordinator(FakeTutor()).handle([], "Show my learning progress report.")


@pytest.mark.asyncio
async def test_coordinator_research_planning_is_explicitly_unverified():
    result = await Coordinator(FakeTutor()).execute(
        "research_planning",
        topic="Accessible campus navigation",
        message="How can navigation support be improved?",
    )

    assert result.data["source_verified"] is False
    assert result.data["objectives"]
    assert "citation" in result.data["notice"].lower()
