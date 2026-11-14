from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Generation:
    text: str
    input_tokens: int
    output_tokens: int
    model: str


class LLMProvider(Protocol):
    name: str
    model: str

    async def generate(self, messages: list[dict[str, str]], max_tokens: int) -> Generation:
        ...

    async def health_check(self) -> bool:
        ...
