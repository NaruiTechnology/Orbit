#!/usr/bin/env bash
set -euo pipefail

PROJECT_PARENT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${ORBIT_POSTGRES_DATA:-${PROJECT_PARENT}/.postgres}"
PORT="${ORBIT_DB_PORT:-55432}"
HOST="${ORBIT_DB_HOST:-127.0.0.1}"
ADMIN_PASSWORD="${ORBIT_DB_ADMIN_PASSWORD:-orbit_admin_change_me}"
POSTGRES_BIN="$(pg_config --bindir)"

if [[ ! -f "${DATA_DIR}/PG_VERSION" ]]; then
  mkdir -p "${DATA_DIR}"
  password_file="$(mktemp)"
  trap 'rm -f "${password_file}"' EXIT
  printf '%s\n' "${ADMIN_PASSWORD}" > "${password_file}"
  chmod 600 "${password_file}"
  "${POSTGRES_BIN}/initdb" \
    --pgdata="${DATA_DIR}" \
    --username=postgres \
    --pwfile="${password_file}" \
    --encoding=UTF8 \
    --locale-provider=icu \
    --icu-locale=und \
    --auth-local=trust \
    --auth-host=scram-sha-256
fi

if "${POSTGRES_BIN}/pg_ctl" --pgdata="${DATA_DIR}" status >/dev/null 2>&1; then
  printf 'Orbit PostgreSQL is already running on %s:%s\n' "${HOST}" "${PORT}"
  exit 0
fi

if pg_isready --host="${HOST}" --port="${PORT}" >/dev/null 2>&1; then
  printf 'Another PostgreSQL server is already listening on %s:%s\n' "${HOST}" "${PORT}" >&2
  exit 1
fi

"${POSTGRES_BIN}/pg_ctl" \
  --pgdata="${DATA_DIR}" \
  --log="${DATA_DIR}/server.log" \
  --options="-h ${HOST} -p ${PORT} -k ${DATA_DIR}" \
  --wait \
  start

if ! pg_isready --host="${HOST}" --port="${PORT}" >/dev/null 2>&1; then
  printf 'PostgreSQL process started but is not accepting connections on %s:%s\n' "${HOST}" "${PORT}" >&2
  printf 'See %s for the server error.\n' "${DATA_DIR}/server.log" >&2
  exit 1
fi

printf 'Orbit PostgreSQL started on %s:%s using %s\n' "${HOST}" "${PORT}" "${DATA_DIR}"
