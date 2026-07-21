"""Database readiness state used before the API is launched."""

from .executeShellCommand_state import executeShellCommand_state


class verifyDatabase_state(executeShellCommand_state):
    pass
