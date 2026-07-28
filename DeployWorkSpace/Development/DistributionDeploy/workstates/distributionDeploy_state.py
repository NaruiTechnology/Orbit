"""Base class for Orbit DistributionDeploy work-states."""

from __future__ import annotations


class distributionDeploy_state:
    def __init__(self, thread, action_name: str, action: dict):
        self.thread = thread
        self.action_name = action_name
        self.action = action
        self.success = False

    def run(self) -> bool:
        raise NotImplementedError
