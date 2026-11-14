import asyncio
import time
from collections import defaultdict, deque
from uuid import UUID


class UserRateLimiter:
    def __init__(self, limit: int, window_seconds: int = 60) -> None:
        self._limit = limit
        self._window_seconds = window_seconds
        self._events: dict[UUID, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def allow(self, user_id: UUID) -> bool:
        now = time.monotonic()
        async with self._lock:
            events = self._events[user_id]
            while events and now - events[0] >= self._window_seconds:
                events.popleft()
            if len(events) >= self._limit:
                return False
            events.append(now)
            return True
