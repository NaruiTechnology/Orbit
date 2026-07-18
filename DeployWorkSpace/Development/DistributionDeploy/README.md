# Orbit DistributionDeploy

This package follows the manifest location and naming convention of
`~/Project/IobeamTech/Development/DeployWorkSpace/Development/DistributionDeploy`.

Build the distribution from the Orbit root:

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit
python3 build_distribution.py

# Compatibility entry point with the foreign DeployWorkSpace package.
python3 DeployWorkSpace/Development/DistributionDeploy/buidCompiledDist.py
```

Or use the package entry point:

```bash
python3 DeployWorkSpace/Development/DistributionDeploy/distributionDeployApp.py \
  -j DeployWorkSpace/Development/DistributionDeploy/Json/DistributionDeploy.json
```

The builder walks the Orbit root recursively, preserves `.py` source files,
produces no `.pyc` files, honors the repository `.gitignore`, and includes all
other repository contents. It creates an embedded
`DeployWorkSpace/Development/DistributionDeploy/dist_app.zip`, then creates a
timestamped `DeployWorkspace_v<version>_<MMDDYY_HHMM>.zip` containing the full
DeployWorkSpace package and embedded distribution. Glasgow work-states are not
present in this manifest.
