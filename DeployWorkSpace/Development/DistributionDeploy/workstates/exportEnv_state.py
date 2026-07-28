from .distributionDeploy_state import distributionDeploy_state

class exportEnv_state(distributionDeploy_state):
    def run(self) -> bool:
        exports = self.action.get("actionData", {}).get("exports", {})
        self.thread.environment.update({key: str(value) for key, value in exports.items()})
        self.success = True
        return True
