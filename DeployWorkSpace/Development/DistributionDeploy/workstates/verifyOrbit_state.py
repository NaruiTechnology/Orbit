"""Verification state for the generated distribution."""

from __future__ import annotations

from time import monotonic, sleep
from urllib.request import urlopen

from .distributionDeploy_state import distributionDeploy_state


class verifyOrbit_state(distributionDeploy_state):
    def run(self) -> bool:
        data = self.action.get("actionData", {})
        deadline = monotonic() + float(self.action.get("timeout", 60))
        self.success = False
        while monotonic() < deadline:
            try:
                with urlopen(data["healthUrl"], timeout=3) as response:
                    health_ok = response.status == 200
                with urlopen(data["frontendUrl"], timeout=3) as response:
                    frontend_ok = response.status == 200
                if health_ok and frontend_ok:
                    self.success = True
                    break
            except Exception:
                pass
            sleep(1)
        return self.success
