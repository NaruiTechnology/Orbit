import zipfile

from .distributionDeploy_state import distributionDeploy_state


class unzipDistribution_state(distributionDeploy_state):
    def run(self) -> bool:
        archive_dir = self.thread.source_root / "DeployWorkSpace/Development/DistributionDeploy"
        archives = sorted(archive_dir.glob("dist_app*.zip"))
        if not archives:
            self.success = False
            return False
        with zipfile.ZipFile(archives[-1]) as archive:
            archive.extractall(self.thread.deploy_root)
        self.success = True
        return self.success
