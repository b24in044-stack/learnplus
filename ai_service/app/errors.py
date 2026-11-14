class ServiceUnavailableError(Exception):
    pass


class ProviderError(Exception):
    pass


class ProviderRateLimitError(ProviderError):
    def __init__(self, message: str, retry_after: float) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class UnauthorizedError(Exception):
    pass


class ForbiddenError(Exception):
    pass


class ConversationNotFoundError(Exception):
    pass


class UnsupportedIntentError(Exception):
    pass
