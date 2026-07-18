"""Verification state for the generated distribution."""

from __future__ import annotations

from urllib.request import urlopen

from .distributionDeploy_state import distributionDeploy_state


class verifyOrbit_state(distributionDeploy_state):
    def run(self) -> bool:
        data = self.action.get("actionData", {})
        try:
            with urlopen(data["healthUrl"], timeout=5) as response:
                health_ok = response.status == 200
            with urlopen(data["frontendUrl"], timeout=5) as response:
                frontend_ok = response.status == 200
            self.success = health_ok and frontend_ok
        except Exception:
            self.success = False
        return self.success
