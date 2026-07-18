from .distributionDeploy_state import distributionDeploy_state

class launchUI_state(distributionDeploy_state):
    def run(self) -> bool:
        self.success = True
        return True
