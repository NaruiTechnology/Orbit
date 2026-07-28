#!/usr/bin/env bash
set -euo pipefail

PROJECT_PARENT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${ORBIT_POSTGRES_DATA:-${PROJECT_PARENT}/.postgres}"
POSTGRES_BIN="$(pg_config --bindir)"

if [[ ! -f "${DATA_DIR}/PG_VERSION" ]]; then
  printf 'Orbit PostgreSQL cluster does not exist at %s\n' "${DATA_DIR}"
  exit 0
fi

if ! "${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIR}" status >/dev/null 2>&1; then
  printf 'Orbit PostgreSQL is not running\n'
  exit 0
fi

"${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIR}" --wait --mode=fast stop
printf 'Orbit PostgreSQL stopped\n'

