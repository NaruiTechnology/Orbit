import subprocess

from .distributionDeploy_state import distributionDeploy_state


class unzipDistribution_state(distributionDeploy_state):
    def run(self) -> bool:
        archive_dir = self.thread.source_root / "DeployWorkSpace/Development/DistributionDeploy"
        archives = sorted(archive_dir.glob("dist_app*.zip"))
        if not archives:
            self.success = False
            return False
        result = subprocess.run(
            ["unzip", "-o", str(archives[-1]), "-d", str(self.thread.deploy_root)],
            cwd=self.thread.source_root,
            check=False,
        )
        self.success = result.returncode == 0
        return self.success
