# Orbit Automation

Orbit Automation is a full-stack workflow automation and management platform built with PostgreSQL, FastAPI, React, Redux Toolkit, TypeScript, and AG Grid. Its initial workflow catalog is generated from `~/Downloads/单束系统 初版.xlsx`.

The workbook's `全流程图` sheet is the 17-stage master workflow. The other sheets are imported as linked subworkflows, rule catalogs, lookup tables, field dictionaries, metrics, and operational ledgers. Notification templates are stored in `orbit_workflow.notification_template` for component lookup rather than shown as subworkflows.

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

# 3. Start FastAPI from config/application.json (127.0.0.1:8120).venv/bin/python scripts/run_api.py --reload

# 4. In another terminal, start React (127.0.0.1:5274).
npm run dev
```

Open `http://127.0.0.1:5274`. FastAPI documentation is at `http://127.0.0.1:8120/docs`.

Stop the dedicated database with:

```bash
./scripts/stop_local_postgres.sh
```

If the API reports `connection refused` on port `55432`, start the database
from the Orbit root first. Include `./`; the shell does not search the current
directory for commands automatically:

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit
./scripts/start_local_postgres.sh
.venv/bin/python scripts/check_database.py --timeout 10
.venv/bin/python scripts/bootstrap_database.py
.venv/bin/python scripts/run_api.py --reload
```

## Architecture

PostgreSQL is separated into four schemas:

- `orbit_identity`: organizations, departments, laboratories, users, roles, permissions, memberships, and workflow access grants.
- `orbit_workflow`: localized definitions, dynamic column schemas, graph edges, JSONB grid records, and reusable notification-template lookup rows.
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

## SMS Verification Configuration

Orbit's current SMS implementation is development-only. `POST /api/v1/auth/send-sms`
generates a mock code and returns it as `dev_code`; no SMS vendor is called. The
implementation is in `backend/app/api/routes/auth.py`.

There is no SMS-vendor JSON configuration in Orbit. The JSON files under `config/`
contain application and database settings only.

The imported Iobeam reference project contains the planned Twilio environment
variables in `~/Project/IobeamTech/Development/ionbeam-web/backend/.env` (use
`.env.example` as the template):

```text
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

Those variables are not consumed by Orbit until a Twilio provider adapter is
implemented and enabled. Do not commit real Twilio credentials.

## Email Configuration

The workflow-panel mail icon opens an HTML compose dialog. When SMTP is
configured, Orbit sends a multipart plain-text/HTML message through the API.
When SMTP is not configured, the dialog falls back to the operating system's
`mailto:` handler so a locally installed webmail or mail application can take
over. The editor supports rich text and HTML tables. SMTP preserves the HTML
part; the `mailto:` fallback intentionally sends plain text because the
`mailto:` standard does not reliably carry rich HTML.

The non-secret SMTP defaults are stored in
`config/application.json` under `MailConfig`:

```json
{
  "SmtpHost": "smtp.gmail.com",
  "SmtpPort": 587,
  "SmtpUser": "lyh1154@gmail.com",
  "SmtpFrom": "lyh1154@gmail.com",
  "StartTLS": true,
  "SSL": false,
  "TimeoutSeconds": 20
}
```

Change those values in the JSON file when the SMTP server or sender changes.
For Gmail, enable 2-Step Verification and create an App Password at
<https://myaccount.google.com/apppasswords>. Do not use the normal Google
account password, and do not put the App Password in JSON or source control.
Provide it only to the API process at runtime:

```bash
cd /home/vboxuser/Project/OrbitAutomation/Orbit
read -rsp "Gmail App Password: " ORBIT_SMTP_PASSWORD
echo
export ORBIT_SMTP_PASSWORD
.venv/bin/python scripts/run_api.py --reload
```

The hidden prompt keeps the password out of shell history and files. The API
must be started in the same shell that exports `ORBIT_SMTP_PASSWORD`.
Environment variables override the corresponding non-secret JSON settings if
needed: `ORBIT_SMTP_HOST`, `ORBIT_SMTP_PORT`, `ORBIT_SMTP_USER`,
`ORBIT_SMTP_FROM`, `ORBIT_SMTP_STARTTLS`, `ORBIT_SMTP_SSL`, and
`ORBIT_SMTP_TIMEOUT`.

The relevant endpoints are `GET /api/v1/mail/status` and
`POST /api/v1/mail/send`. The frontend uses `mailto:` only when the status
endpoint reports that SMTP is unavailable, or when the user explicitly
chooses “Open mail app”.

## Orbit SLA Service

`scripts/orbit_service.py` is a standalone one-shot worker intended for the OS
cron table. Its JSON configuration file is:

```text
config/orbit_service.json
```

The default contents are:

```json
{
  "interval_minutes": 60,
  "run_on_start": true,
  "lock_file": "/tmp/orbit_service.lock",
  "last_run_file": "/tmp/orbit_service.last-run",
  "access_url_base": "http://127.0.0.1:5274"
}
```

`interval_minutes` is the effective schedule and is currently set to 60
minutes. The example cron entry invokes the worker every minute; the worker
reads `config/orbit_service.json`, enforces the configured interval, and exits
immediately when the next run is not due. `lock_file` prevents overlapping
runs, while `last_run_file` records the last successful cycle:

```bash
crontab -e
# copy scripts/orbit_service.cron.example
```

Do not paste the cron line at a normal Bash prompt. Either install it with the
provided helper:

```bash
python scripts/install_orbit_service_cron.py
```

or open `crontab -e` and paste the complete entry as one physical line:

```cron
* * * * * cd /home/vboxuser/Project/OrbitAutomation/Orbit && .venv/bin/python scripts/orbit_service.py 2>&1 | /usr/bin/tee -a /tmp/orbit_service.log
```

For manual execution with output visible on the console and appended to the
same log file, use `tee` and `2>&1` (`2>&1` redirects errors to standard output):

```bash
python scripts/orbit_service.py 2>&1 | tee -a /tmp/orbit_service.log
```

The log reports `started successfully`, `completed successfully`, and `stopped`
when the cycle runs, or explains when it was skipped because the configured
interval has not elapsed.

For an immediate demonstration or administrative test, bypass the interval
check with `--force`:

```bash
python scripts/orbit_service.py --force 2>&1 | tee -a /tmp/orbit_service.log
```

Database migration `database/006_sla_orbit_service.sql` adds the SLA query and
rule-evaluation functions, per-step XML/CSS email templates, and notification
deduplication records. Apply it through `scripts/bootstrap_database.py` on a
new or upgraded database.

The database functions added by this migration are:

| Function | Purpose |
| --- | --- |
| `orbit_workflow.extract_sla_days(text)` | Extracts the numeric day value from SLA text. |
| `orbit_runtime.get_sla_workflow_steps(as_of, workflow_step_id)` | Returns active SLA-enabled workflow steps, due times, violation status, source data, and catalog rules. |
| `orbit_runtime.evaluate_sla_workflow_steps(workflow_step_id, as_of)` | Returns the rule-evaluation/next-step placeholder decisions. |
| `orbit_workflow.get_email_template(workflow_step_id)` | Looks up the XML/CSS email template for a workflow step. |
| `orbit_runtime.claim_sla_notification(...)` | Claims a notification while preventing duplicate sends. |
| `orbit_runtime.finish_sla_notification(...)` | Marks a notification as sent or failed. |

The protected API endpoint for manually running the rule-evaluation pass for a
catalog workflow-step UUID is:

```text
POST /api/v1/workflows/steps/{workflow_step_id}/sla-advance
```

The endpoint returns the loaded origin-catalog business rules and the next
catalog step, but currently returns `TODO_RULE_EVALUATION` without mutating
workflow state. This is the deliberate placeholder for the business-rule
implementation.

## Workbook Sync

The source workbook is not copied into the repository. The checked-in `data/workflow_catalog.json` includes a SHA-256 source hash and the original sheet, row, header, and cell references.

Regenerate and import it with:

```bash
.venv/bin/python scripts/generate_catalog.py \
  --source "$HOME/Downloads/单束系统 初版.xlsx"
.venv/bin/python scripts/import_catalog.py

# Optional: populate repeatable development fixtures for business entities.
.venv/bin/python scripts/seed_mock_data.py
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
`requirements.txt` installs it with development tooling and is the single
source of truth for Python dependencies.

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
└── requirements.txt  Canonical editable development installation
```
