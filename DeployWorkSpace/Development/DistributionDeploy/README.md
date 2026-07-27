# Orbit DistributionDeploy (Windows)

This package creates a self-contained Orbit handoff archive for Windows 10/11
with PowerShell. It preserves Python source and excludes ignored development
files.

Build and verify the handoff from the Orbit root:

```powershell
Set-Location C:\path\to\Orbit
python build_distribution.py
tar -tf DeployWorkspace_v*.zip | Select-String 'dist_app.zip|DistributionDeploy.json'
```

Copy the timestamped `DeployWorkspace_*.zip` to the Windows target. Extract it
to a staging directory, then run the workflow from its extracted package:

```powershell
$handoff = Join-Path $env:USERPROFILE 'orbit-handoff'
Expand-Archive (Get-ChildItem DeployWorkspace_v*.zip | Select-Object -Last 1) $handoff -Force
Set-Location $handoff\DeployWorkSpace\Development\DistributionDeploy
python distributionDeployApp.py
```

The workflow creates or updates `%USERPROFILE%\OrbitAutomation`, unpacks the
source distribution there, creates `.venv`, installs Python and frontend
dependencies, registers the Orbit SLA worker in Windows Task Scheduler, starts
the local PostgreSQL/API/frontend services, and waits for both HTTP endpoints
to become healthy. The worker reads `config\orbit_service.json` and is
scheduled every minute; its default effective interval is one hour.

The final startup actions run from the deployed Orbit root in this order:

```powershell
.\scripts\start_local_postgres.ps1
.\.venv\Scripts\python.exe scripts\check_database.py --timeout 10
.\.venv\Scripts\python.exe scripts\bootstrap_database.py
.\.venv\Scripts\python.exe scripts\run_api.py --reload
npm --prefix frontend run dev -- --host 127.0.0.1
```

The API and frontend commands are launched as detached services, followed by
health checks for both endpoints. Do not run the workflow from inside the
final deploy directory: the staging copy is the source of `dist_app.zip`,
while the deploy root is where the extracted application is executed.
