# Orbit Automation

Orbit Automation is a full-stack workflow automation and management platform built with PostgreSQL, FastAPI, React, Redux Toolkit, TypeScript, and AG Grid. Its initial workflow catalog is generated from `~/Downloads/单束系统 初版.xlsx`.

The workbook's `全流程图` sheet is the 17-stage master workflow. The other 23 sheets are imported as linked subworkflows, rule catalogs, notification templates, field dictionaries, metrics, and operational ledgers. The generated catalog currently contains 24 definitions and 481 source-traced records.

## Runtime Layout

| Service | Orbit port | Reference project port |
| --- | ---: | ---: |
| React/Vite | `5274` | `5173` |
| FastAPI | `8120` | Node API `4000` |
| Orbit PostgreSQL | `55432` | System PostgreSQL `5432` |
| Reference Glasgow | n/a | `8765` |

The dedicated PostgreSQL 17 cluster is stored at `/home/vboxuser/Project/OrbitAutomation/.postgres`. It coexists with the system cluster without modifying it.

## Quick Start

Dependencies have been installed into `.venv` and `frontend/node_modules` in this workspace.

For a fresh checkout:

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd frontend
npm install
cd ..
```

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit

# 1. Start the user-owned PostgreSQL cluster.
./scripts/start_local_postgres.sh

# 2. Idempotently create the role/database/schemas and import the catalog.
.venv/bin/python scripts/bootstrap_database.py

# 3. Start FastAPI from config/application.json (127.0.0.1:8120).
.venv/bin/python scripts/run_api.py --reload

# 4. In another terminal, start React (127.0.0.1:5274).
cd frontend
npm run dev
```

Open `http://127.0.0.1:5274`. FastAPI documentation is at `http://127.0.0.1:8120/docs`.

Stop the dedicated database with:

```bash
./scripts/stop_local_postgres.sh
```

## Architecture

PostgreSQL is separated into four schemas:

- `orbit_identity`: organizations, departments, laboratories, users, roles, permissions, memberships, and workflow access grants.
- `orbit_workflow`: localized definitions, dynamic column schemas, graph edges, and JSONB grid records.
- `orbit_runtime`: workflow instances, tasks, and transition history.
- `orbit_audit`: immutable record and catalog change events.

The UI uses a full-screen two-panel layout. The left panel contains a workbook/domain/subworkflow cascade, controls, and a dynamic AG Grid. The right panel renders the selected row/cell against its workflow graph. The layout stacks on narrow screens.

The default seeded development user is `orbit.admin`. Requests resolve it through `X-Orbit-User`; authorization still runs through persisted role, workflow, organization, department, and laboratory grants. In production, a trusted reverse proxy or SSO adapter must authenticate the user and set this header after stripping client-supplied copies.

## Multi-Language Data

- The database and generated catalog use UTF-8.
- Every application connection sets `client_encoding=UTF8` and `timezone=Asia/Shanghai`.
- Localized master fields are JSONB objects keyed by `en`, `zh_CN`, and `zh_HK`.
- User-entered values can contain mixed scripts in the same JSONB value.
- English code identifiers are used throughout Python and TypeScript; original Chinese headers and cell coordinates remain in source metadata.
- PostgreSQL ICU collations provide allowlisted English, Simplified Chinese, and Traditional Chinese sorting. AG Grid also uses `Intl.Collator` for consistent in-browser sorting.

Database settings are in `config/database.json`. All connection fields can be overridden without editing JSON:

```text
ORBIT_DATABASE_URL
ORBIT_DB_HOST
ORBIT_DB_PORT
ORBIT_DB_NAME
ORBIT_DB_USER
ORBIT_DB_PASSWORD
ORBIT_DB_SSLMODE
ORBIT_DB_ADMIN_USER
ORBIT_DB_ADMIN_PASSWORD
```

## Workbook Sync

The source workbook is not copied into the repository. The checked-in `data/workflow_catalog.json` includes a SHA-256 source hash and the original sheet, row, header, and cell references.

Regenerate and import it with:

```bash
.venv/bin/python scripts/generate_catalog.py \
  --source "$HOME/Downloads/单束系统 初版.xlsx"
.venv/bin/python scripts/import_catalog.py
```

The workbook remains the catalog source of truth. A catalog import updates source-derived configuration rows and writes an audit event.

## AutomationPy Fiber

The `AutomationPy` framework is vendored as a top-level package so imports work
from Python, IDE language servers, tests, and installed console commands without
external path injection. The snapshot provenance is recorded in
`AutomationPy/VENDORED_FROM.md`; its UTF-8 fiber configuration is
`automation/Json/OrbitAutomation.json`.

```bash
# Validate config, verify DB encoding/timezone, and import the catalog.
.venv/bin/orbit-fiber

# Also run states marked skip=true, including bootstrap and detached API launch.
.venv/bin/orbit-fiber --include-skipped

# Equivalent module form.
.venv/bin/python -m automation.orbitAutomationApp
```

The root `pyproject.toml` is the canonical Python project definition.
`requirements.txt` installs it with development tooling, while the requested
`requirement.txt` filename delegates to that canonical manifest.

## API Surface

Key endpoints under `/api/v1`:

- `GET /health`
- `GET /session`
- `GET /workflows`
- `GET /workflows/{key}`
- `GET /workflows/{key}/records`
- `PATCH /workflows/{key}/records/{record_id}`
- `GET /workflows/{key}/tree`
- `POST /workflows/{key}/instances`
- `POST /workflows/instances/{instance_id}/transitions`

Grid edits use optimistic `version` checks and are audited. Record queries validate dynamic sort keys against the imported column schema before composing SQL.

## Verification

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit

.venv/bin/pytest -q backend/tests
.venv/bin/ruff check backend/app backend/tests scripts automation

ORBIT_RUN_INTEGRATION=1 .venv/bin/pytest -q \
  backend/tests/test_api_integration.py

cd frontend
npm run build
```

The integration test verifies server/client UTF-8, localized reads, mixed-language JSONB persistence with restore, optimistic versions, and workflow instance transitions.

## Project Structure

```text
Orbit/
├── AutomationPy/     Vendored automation framework package
├── automation/       Orbit fiber, states, thread, and JSON config
├── backend/          FastAPI contracts, auth, repository, and tests
├── config/           JSON application and PostgreSQL configuration
├── data/             Generated workbook catalog
├── database/         Idempotent schema and identity seed SQL
├── frontend/         React/Redux/TypeScript/AG Grid application
├── scripts/          Workbook, DB, local cluster, and API operations
├── pyproject.toml    Canonical Python package and tool configuration
├── requirement.txt   Requested compatibility dependency manifest
└── requirements.txt  Canonical editable development installation
```
