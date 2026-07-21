# Orbit DistributionDeploy

This package creates a self-contained Orbit handoff archive. It preserves
Python source, excludes ignored development files, and contains the JSON
manifest needed to deploy on Ubuntu 24.04 or newer.

Build the distribution from the Orbit root:

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit
python3 build_distribution.py
```

Or use the package entry point:

```bash
python3 DeployWorkSpace/Development/DistributionDeploy/distributionDeployApp.py \
  -j DeployWorkSpace/Development/DistributionDeploy/Json/DistributionDeploy.json
```

The builder walks the Orbit root recursively, preserves `.py` source files,
produces no `.pyc` files, honors `.gitignore`, and checks that the deployment
manifest and database states are present. It creates an embedded
`DeployWorkSpace/Development/DistributionDeploy/dist_app.zip`, then creates a
timestamped `DeployWorkspace_v<version>_<MMDDYY_HHMM>.zip` containing the
handoff package and embedded distribution.

## Reliable handoff and deployment

Build and verify the handoff on the developer host:

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit
python3 build_distribution.py
unzip -l DeployWorkspace_v*.zip | grep -E 'dist_app.zip|DistributionDeploy.json'
```

Copy the timestamped `DeployWorkspace_*.zip` to the Ubuntu target. Extract it
to a staging directory, then run the workflow from its extracted package:

```bash
mkdir -p "$HOME/orbit-handoff"
unzip -o DeployWorkspace_v*.zip -d "$HOME/orbit-handoff"
cd "$HOME/orbit-handoff/DeployWorkSpace/Development/DistributionDeploy"
python3 distributionDeployApp.py
```

The workflow creates or updates `~/OrbitAutomation`, unpacks the source
distribution there, creates `.venv`, installs Python and frontend dependencies,
installs the Orbit SLA worker in the target user's crontab, starts the local
PostgreSQL/API/frontend services, and waits for both HTTP endpoints to become
healthy. The worker reads `config/orbit_service.json` and is invoked every
minute by cron; its default effective interval is one hour. Use
`-r /path/to/deploy-root` to select another
target directory, or `--production` to enable production manifest overrides.

For a manual API start from an already unpacked deployment, start PostgreSQL
first with `./scripts/start_local_postgres.sh`; omitting `./` causes
`command not found` in a normal Ubuntu shell.

Do not run the workflow from inside the final deploy directory: the staging
copy is the source of `dist_app.zip`, while the deploy root is the directory
where the extracted application is executed.
