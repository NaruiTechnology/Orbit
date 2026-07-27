$ErrorActionPreference = 'Stop'

$projectParent = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataDir = if ($env:ORBIT_POSTGRES_DATA) { $env:ORBIT_POSTGRES_DATA } else { Join-Path $projectParent '.postgres' }
$postgresBin = (Get-Command pg_config -ErrorAction Stop).Source | Split-Path
$pgCtl = Join-Path $postgresBin 'pg_ctl.exe'

if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
    Write-Output "Orbit PostgreSQL cluster does not exist at $dataDir"
    exit 0
}
& $pgCtl --pgdata=$dataDir status *> $null
if ($LASTEXITCODE -ne 0) { Write-Output 'Orbit PostgreSQL is not running'; exit 0 }
& $pgCtl --pgdata=$dataDir --wait --mode=fast stop
Write-Output 'Orbit PostgreSQL stopped'
