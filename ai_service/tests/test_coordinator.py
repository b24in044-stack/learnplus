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


class FakeAssignmentLearning:
    async def history(self):
        return {"completedAssignments": [{"id": "assignment-1"}]}

    async def assignment_detail(self, assessment_id):
        return {"assignment": {"id": assessment_id}, "details": {}}

    async def analyze_completed_assignment(self, assessment_id):
        return {"status": "LEARNING_ANALYSIS_COMPLETED", "assessmentId": assessment_id}


class FakeExplainability:
    async def explain(self, data, sources):
        return {"evidenceSources": sources}


class FakeLearningAgents:
    assignment_learning = FakeAssignmentLearning()
    explainability = FakeExplainability()


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


@pytest.mark.asyncio
async def test_coordinator_routes_learning_history_detail_and_retry_through_learning_agent():
    coordinator = Coordinator(None, FakeLearningAgents())

    history = await coordinator.execute("assignment_learning_history")
    detail = await coordinator.execute(
        "assignment_learning_detail",
        assessment_id="assignment-1",
    )
    retry = await coordinator.execute(
        "assignment_learning_retry",
        assessment_id="assignment-1",
    )

    assert history.data["completedAssignments"] == [{"id": "assignment-1"}]
    assert detail.data["assignment"]["id"] == "assignment-1"
    assert retry.data["status"] == "LEARNING_ANALYSIS_COMPLETED"
    assert all(workflow.agent_steps[0]["agent_id"] == "assignment_learning"
               for workflow in (history, detail, retry))
    assert "explainability" in history.data


@pytest.mark.asyncio
async def test_coordinator_does_not_expose_missing_or_ineligible_assignment_analysis():
    class IneligibleAssignmentLearning(FakeAssignmentLearning):
        async def assignment_detail(self, assessment_id):
            return None

        async def analyze_completed_assignment(self, assessment_id):
            return {"status": "NOT_ELIGIBLE"}

    class IneligibleLearningAgents(FakeLearningAgents):
        assignment_learning = IneligibleAssignmentLearning()

    coordinator = Coordinator(None, IneligibleLearningAgents())
    with pytest.raises(LookupError, match="Completed assignment"):
        await coordinator.execute("assignment_learning_detail", assessment_id="missing")
    with pytest.raises(LookupError, match="published graded assignments"):
        await coordinator.execute("assignment_learning_retry", assessment_id="unpublished")
