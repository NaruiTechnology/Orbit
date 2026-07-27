$ErrorActionPreference = 'Stop'

$projectParent = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataDir = if ($env:ORBIT_POSTGRES_DATA) { $env:ORBIT_POSTGRES_DATA } else { Join-Path $projectParent '.postgres' }
$port = if ($env:ORBIT_DB_PORT) { $env:ORBIT_DB_PORT } else { '55432' }
$hostAddress = if ($env:ORBIT_DB_HOST) { $env:ORBIT_DB_HOST } else { '127.0.0.1' }
$postgresBin = (Get-Command pg_config -ErrorAction Stop).Source | Split-Path
$pgCtl = Join-Path $postgresBin 'pg_ctl.exe'
$pgIsReady = Join-Path $postgresBin 'pg_isready.exe'

if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    $adminPassword = if ($env:ORBIT_DB_ADMIN_PASSWORD) { $env:ORBIT_DB_ADMIN_PASSWORD } else { 'orbit_admin_change_me' }
    $passwordFile = Join-Path ([System.IO.Path]::GetTempPath()) "orbit-pg-$PID.pwd"
    try {
        Set-Content -Path $passwordFile -Value $adminPassword -NoNewline
        & (Join-Path $postgresBin 'initdb.exe') --pgdata=$dataDir --username=postgres --pwfile=$passwordFile --encoding=UTF8 --locale-provider=icu --icu-locale=und --auth-local=trust --auth-host=scram-sha-256
    } finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $passwordFile
    }
}

& $pgCtl --pgdata=$dataDir status *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Output "Orbit PostgreSQL is already running on ${hostAddress}:$port"
    exit 0
}

& $pgIsReady --host=$hostAddress --port=$port *> $null
if ($LASTEXITCODE -eq 0) {
    throw "Another PostgreSQL server is already listening on ${hostAddress}:$port"
}

$logFile = Join-Path $dataDir 'server.log'
& $pgCtl --pgdata=$dataDir --log=$logFile --options="-h $hostAddress -p $port" --wait start
& $pgIsReady --host=$hostAddress --port=$port *> $null
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL started but is not accepting connections on ${hostAddress}:$port. See $logFile" }
Write-Output "Orbit PostgreSQL started on ${hostAddress}:$port using $dataDir"
