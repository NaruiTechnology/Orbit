from pathlib import Path
from .executeShellCommand_state import executeShellCommand_state

class unzipDistribution_state(executeShellCommand_state):
    def run(self) -> bool:
        archive_dir = self.thread.orbit_root / "DeployWorkSpace/Development/DistributionDeploy"
        if not list(archive_dir.glob("dist_app*.zip")):
            self.success = True
            return True
        return super().run()
