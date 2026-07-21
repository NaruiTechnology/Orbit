from .distributionDeploy_state import distributionDeploy_state


class createDeployFolder_state(distributionDeploy_state):
    def run(self) -> bool:
        self.thread.deploy_root.mkdir(parents=True, exist_ok=True)
        self.success = True
        return True
