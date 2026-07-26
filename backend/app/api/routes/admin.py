"""Administrator-only system configuration endpoints."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from psycopg import Connection
from psycopg import sql
from psycopg.types.json import Jsonb

from app.auth import get_current_user, require_administration_access
from app.database import get_connection
from app.schemas import SessionInfo
from app.services.localization import localized_value

router = APIRouter(prefix="/admin", tags=["admin"])


class WorkflowStepAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    businessEntity: str | None = Field(default=None, max_length=160)
    sla: str | None = Field(default=None, max_length=200)
    laboratory_id: UUID | None = None
    phone_number: str = Field(default="", max_length=80)
    contact_email: str = Field(default="", max_length=320)
    contact_name: str = Field(default="", max_length=200)
    hr_employee_id: UUID | None = None


_WORKFLOW_BUSINESS_ENTITIES = (
    "Customer Profile", "Billing Information", "Quotation", "Contract",
    "Sales Order", "Chip Retention", "Bill", "Payment Collection",
    "Outsourced Service",
)


class BusinessEntityRecordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = Field(default_factory=dict)
    version: int | None = None


class AccessUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_code: str = Field(min_length=1, max_length=32)
    is_active: bool
    login_name: str | None = Field(default=None, min_length=1, max_length=120)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=320)
    phone_number: str | None = Field(default=None, max_length=40)
    company_name: str | None = Field(default=None, max_length=160)
    site: str | None = Field(default=None, max_length=160)


class AccessUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login_name: str = Field(min_length=1, max_length=120)
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=320)
    phone_number: str = Field(default="", max_length=40)
    company_name: str = Field(default="", max_length=160)
    site: str = Field(default="Beijing(北京)", max_length=160)
    role_code: str = Field(default="user", min_length=1, max_length=32)
    is_active: bool = True


def _require_admin(user: SessionInfo, connection: Connection[dict[str, Any]]) -> None:
    require_administration_access(connection, user.user_id)


@router.get("/access-management")
def access_management(
    locale: str = Query(default="en"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    roles = connection.execute(
        """SELECT role_id, role_name, display_name_i18n
             FROM orbit_identity.role_definition
            WHERE is_active AND role_name IN ('AUDIT', 'ADMIN', 'SUPER_USER', 'USER')
            ORDER BY CASE role_name WHEN 'AUDIT' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'SUPER_USER' THEN 2 ELSE 3 END"""
    ).fetchall()
    rows = connection.execute(
        """SELECT u.id, u.login_name, u.first_name, u.last_name, u.email,
                  u.phone_number, u.company_name, u.site, u.is_active,
                  u.created_at, MAX(s.login_time) AS last_sign_in,
                  COALESCE(MAX(r.code) FILTER (WHERE r.code IN ('audit','admin','super_user','user')), 'user') AS role_code,
                  COALESCE((array_agg(r.name_i18n ORDER BY r.code) FILTER (WHERE r.code IN ('audit','admin','super_user','user')))[1], '{"en":"User"}'::jsonb) AS role_name_i18n
             FROM orbit_identity.app_user u
             LEFT JOIN orbit_identity.user_role ur ON ur.user_id = u.id
             LEFT JOIN orbit_identity.role r ON r.id = ur.role_id
             LEFT JOIN orbit_identity.auth_session s ON s.user_id = u.id
            GROUP BY u.id
            ORDER BY u.created_at DESC, u.login_name"""
    ).fetchall()
    return {
        "roles": [{"code": row["role_name"].lower(), "name": localized_value(row["display_name_i18n"], locale)} for row in roles],
        "users": [
            {**dict(row), "role_name": localized_value(row["role_name_i18n"], locale)}
            for row in rows
        ],
    }


@router.patch("/access-management/users/{user_id}")
def update_access_user(
    user_id: UUID,
    request: AccessUserUpdate,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    if request.role_code not in {"audit", "admin", "super_user", "user"}:
        raise HTTPException(status_code=422, detail="unsupported access role")
    role = connection.execute("SELECT id FROM orbit_identity.role WHERE code = %s", (request.role_code,)).fetchone()
    if role is None:
        raise HTTPException(status_code=422, detail="access role is not configured")
    updated = connection.execute(
        """UPDATE orbit_identity.app_user
              SET login_name = COALESCE(%s, login_name),
                  first_name = COALESCE(%s, first_name),
                  last_name = COALESCE(%s, last_name),
                  email = COALESCE(%s, email),
                  phone_number = COALESCE(%s, phone_number),
                  company_name = COALESCE(%s, company_name),
                  site = COALESCE(%s, site),
                  is_active = %s
            WHERE id = %s
        RETURNING id""",
        (request.login_name.strip() if request.login_name is not None else None,
         request.first_name.strip() if request.first_name is not None else None,
         request.last_name.strip() if request.last_name is not None else None,
         request.email.strip() if request.email is not None else None,
         request.phone_number.strip() if request.phone_number is not None else None,
         request.company_name.strip() if request.company_name is not None else None,
         request.site.strip() if request.site is not None else None,
         request.is_active, user_id),
    ).fetchone()
    if updated is None:
        raise HTTPException(status_code=404, detail="user not found")
    connection.execute("DELETE FROM orbit_identity.user_role WHERE user_id = %s", (user_id,))
    connection.execute("INSERT INTO orbit_identity.user_role (user_id, role_id) VALUES (%s, %s)", (user_id, role["id"]))
    return {"ok": True, "user_id": user_id, "role_code": request.role_code, "is_active": request.is_active}


@router.post("/access-management/users")
def create_access_user(
    request: AccessUserCreate,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    if request.role_code not in {"audit", "admin", "super_user", "user"}:
        raise HTTPException(status_code=422, detail="unsupported access role")
    role = connection.execute("SELECT id FROM orbit_identity.role WHERE code = %s", (request.role_code,)).fetchone()
    if role is None:
        raise HTTPException(status_code=422, detail="access role is not configured")
    try:
        display_name = f"{request.first_name.strip()} {request.last_name.strip()}".strip()
        row = connection.execute(
            """INSERT INTO orbit_identity.app_user
               (login_name, display_name_i18n, first_name, last_name, email, phone_number, company_name, site, is_active)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id, login_name, first_name, last_name, email, phone_number, company_name, site, is_active, created_at""",
            (request.login_name.strip(), Jsonb({"en": display_name, "zh_CN": display_name, "zh_HK": display_name}),
             request.first_name.strip(), request.last_name.strip(), request.email.strip(),
             request.phone_number.strip(), request.company_name.strip(), request.site.strip(), request.is_active),
        ).fetchone()
    except Exception as error:
        raise HTTPException(status_code=409, detail=f"Could not create account: {error}") from error
    connection.execute("INSERT INTO orbit_identity.user_role (user_id, role_id) VALUES (%s, %s)", (row["id"], role["id"]))
    return {**dict(row), "role_code": request.role_code, "role_name": request.role_code}


@router.delete("/access-management/users/{user_id}", status_code=204)
def delete_access_user(
    user_id: UUID,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> None:
    _require_admin(user, connection)
    if user_id == user.user_id:
        raise HTTPException(status_code=400, detail="The current account cannot be deleted")
    deleted = connection.execute("DELETE FROM orbit_identity.app_user WHERE id = %s RETURNING id", (user_id,)).fetchone()
    if deleted is None:
        raise HTTPException(status_code=404, detail="user not found")


_BUSINESS_ENTITY_SYSTEM_COLUMNS = {
    "id", "organization_id", "department_id", "laboratory_id", "version",
    "created_at", "updated_at",
}
_BUSINESS_ENTITY_TABLES = {
    "customer_profile", "billing_information", "quotation", "contract",
    "sales_order", "chip_retention", "bill", "payment_collection",
    "outsourced_service",
}


def _business_entity_data_type(postgres_type: str) -> str:
    if postgres_type in {"integer", "bigint", "smallint"}:
        return "integer"
    if postgres_type in {"numeric", "decimal", "real", "double precision"}:
        return "decimal"
    if postgres_type == "date":
        return "date"
    if postgres_type in {"boolean"}:
        return "boolean"
    return "text"


def _business_entity_columns(connection: Connection[dict[str, Any]], table_name: str, include_system: bool = False) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT column_name, data_type, is_nullable, is_generated, column_default
          FROM information_schema.columns
         WHERE table_schema = 'orbit_sales' AND table_name = %s
         ORDER BY ordinal_position
        """,
        (table_name,),
    ).fetchall()
    return [
        {
            "key": row["column_name"],
            "data_type": _business_entity_data_type(row["data_type"]),
            "editable": row["column_name"] not in _BUSINESS_ENTITY_SYSTEM_COLUMNS and row["is_generated"] == "NEVER",
            "required": row["is_nullable"] == "NO" and row["column_default"] is None,
            "postgres_type": row["data_type"],
        }
        for row in rows
        if include_system or row["column_name"] not in _BUSINESS_ENTITY_SYSTEM_COLUMNS
    ]


def _business_entity_table(connection: Connection[dict[str, Any]], entity_key: str) -> tuple[str, list[dict[str, Any]]]:
    entity = connection.execute(
        "SELECT table_name FROM orbit_sales.business_entity_catalog WHERE entity_key = %s AND is_active",
        (entity_key,),
    ).fetchone()
    if entity is None or entity["table_name"] not in _BUSINESS_ENTITY_TABLES:
        raise HTTPException(status_code=404, detail="business entity not found")
    table_name = entity["table_name"]
    return table_name, _business_entity_columns(connection, table_name)


def _record_values(request_values: dict[str, Any], columns: list[dict[str, Any]], user: SessionInfo, connection: Connection[dict[str, Any]]) -> dict[str, Any]:
    editable = {column["key"]: column for column in columns if column["editable"]}
    laboratory_column = next((column for column in columns if column["key"] == "laboratory_id"), None)
    if laboratory_column is not None:
        editable["laboratory_id"] = laboratory_column
    unknown = sorted(set(request_values) - set(editable))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unsupported or read-only fields: {', '.join(unknown)}")
    values = dict(request_values)
    scope = user.scope
    for key, value in (("organization_id", scope.organization_id), ("department_id", scope.department_id), ("laboratory_id", scope.laboratory_id)):
        if key in editable and key not in values and value:
            values[key] = value
    if "sales_owner_id" in editable and "sales_owner_id" not in values:
        values["sales_owner_id"] = user.user_id
    if "sales_owner_id" in values and values["sales_owner_id"]:
        owner_value = str(values["sales_owner_id"])
        try:
            UUID(owner_value)
        except ValueError:
            owner = connection.execute(
                """
                SELECT id
                  FROM orbit_identity.app_user
                 WHERE is_active
                   AND (display_name_i18n ->> 'en' = %s OR concat_ws(' ', first_name, last_name) = %s)
                 LIMIT 1
                """,
                (owner_value, owner_value),
            ).fetchone()
            if owner is None:
                raise HTTPException(status_code=422, detail="Sales owner must be selected from the available owners")
            values["sales_owner_id"] = owner["id"]
    return values


def _database_value(value: Any, column: dict[str, Any]) -> Any:
    if column["postgres_type"] == "boolean" and isinstance(value, str):
        if value in {"是", "Yes", "true", "True", "1"}:
            return True
        if value in {"否", "No", "false", "False", "0"}:
            return False
    return Jsonb(value) if column["postgres_type"] == "jsonb" and value is not None else value


@router.get("/business-entities")
def business_entities(
    locale: str = Query(default="en"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    """Return the database-backed nine-entity catalog and dynamic grid data."""
    _require_admin(user, connection)
    laboratories = connection.execute(
        """
        SELECT id, code, name_i18n
          FROM orbit_identity.laboratory
         WHERE is_active
         ORDER BY code
        """
    ).fetchall()
    sales_owners = connection.execute(
        """
        SELECT id, display_name_i18n, first_name, last_name
          FROM orbit_identity.app_user
         WHERE is_active
         ORDER BY first_name, last_name, login_name
        """
    ).fetchall()
    catalog = connection.execute(
        """
        SELECT entity_key, table_name, name_i18n, display_order
          FROM orbit_sales.business_entity_catalog
         WHERE is_active
         ORDER BY display_order
        """
    ).fetchall()
    entities: list[dict[str, Any]] = []
    for entity in catalog:
        table_name = entity["table_name"]
        if table_name not in _BUSINESS_ENTITY_TABLES:
            raise HTTPException(status_code=500, detail=f"Unsupported business entity table: {table_name}")
        columns = _business_entity_columns(connection, table_name)
        selected_columns = [column["key"] for column in columns]
        all_columns = _business_entity_columns(connection, table_name, include_system=True)
        record_columns = [*selected_columns]
        if any(column["key"] == "laboratory_id" for column in all_columns) and "laboratory_id" not in record_columns:
            record_columns.append("laboratory_id")
        if record_columns:
            select_sql = sql.SQL(", ").join(sql.Identifier(column) for column in ["id", *record_columns, "version", "updated_at"])
            records = connection.execute(
                sql.SQL("SELECT {} FROM orbit_sales.{} ORDER BY updated_at DESC LIMIT 500").format(
                    select_sql, sql.Identifier(table_name)
                )
            ).fetchall()
        else:
            records = []
        entities.append(
            {
                "key": entity["entity_key"],
                "table_name": table_name,
                "name": localized_value(entity["name_i18n"], locale),
                "name_i18n": entity["name_i18n"],
                "display_order": entity["display_order"],
                "record_count": len(records),
                "columns": columns,
                "records": [
                    {
                        "id": record["id"],
                        "values": {column: record[column] for column in record_columns},
                        "version": record["version"],
                        "updated_at": record["updated_at"],
                    }
                    for record in records
                ],
            }
        )
    return {
        "entities": entities,
        "laboratories": [
            {"id": row["id"], "code": row["code"], "name": localized_value(row["name_i18n"], locale)}
            for row in laboratories
        ],
        "sales_owners": [
            {
                "id": row["id"],
                "name": localized_value(row["display_name_i18n"], locale) or f"{row['first_name']} {row['last_name']}".strip(),
            }
            for row in sales_owners
        ],
    }


@router.post("/business-entities/{entity_key}/records")
def create_business_entity_record(
    entity_key: str,
    request: BusinessEntityRecordRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    table_name, _public_columns = _business_entity_table(connection, entity_key)
    columns = _business_entity_columns(connection, table_name, include_system=True)
    values = _record_values(request.values, columns, user, connection)
    if not values:
        raise HTTPException(status_code=422, detail="At least one editable field is required")
    column_map = {column["key"]: column for column in columns}
    for key, value in (("organization_id", user.scope.organization_id), ("department_id", user.scope.department_id), ("laboratory_id", user.scope.laboratory_id)):
        if key in column_map and value:
            values.setdefault(key, value)
    names = list(values)
    try:
        statement = sql.SQL("INSERT INTO orbit_sales.{} ({}) VALUES ({}) RETURNING id, version, updated_at").format(
            sql.Identifier(table_name),
            sql.SQL(", ").join(sql.Identifier(name) for name in names),
            sql.SQL(", ").join(sql.Placeholder() for _ in names),
        )
        result = connection.execute(statement, tuple(_database_value(values[name], column_map[name]) for name in names)).fetchone()
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Could not create record: {error}") from error
    return {"id": result["id"], "values": values, "version": result["version"], "updated_at": result["updated_at"]}


@router.patch("/business-entities/{entity_key}/records/{record_id}")
def update_business_entity_record(
    entity_key: str,
    record_id: UUID,
    request: BusinessEntityRecordRequest,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    if request.version is None:
        raise HTTPException(status_code=422, detail="version is required for updates")
    table_name, _public_columns = _business_entity_table(connection, entity_key)
    columns = _business_entity_columns(connection, table_name, include_system=True)
    values = _record_values(request.values, columns, user, connection)
    if not values:
        raise HTTPException(status_code=422, detail="At least one editable field is required")
    column_map = {column["key"]: column for column in columns}
    names = list(values)
    assignments = sql.SQL(", ").join(sql.SQL("{} = {} ").format(sql.Identifier(name), sql.Placeholder()) for name in names)
    statement = sql.SQL("UPDATE orbit_sales.{} SET {} WHERE id = {} AND version = {} RETURNING id, version, updated_at").format(
        sql.Identifier(table_name), assignments, sql.Placeholder(), sql.Placeholder()
    )
    try:
        result = connection.execute(statement, tuple(_database_value(values[name], column_map[name]) for name in names) + (record_id, request.version)).fetchone()
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Could not update record: {error}") from error
    if result is None:
        raise HTTPException(status_code=409, detail="Record was changed or no longer exists")
    return {"id": result["id"], "values": values, "version": result["version"], "updated_at": result["updated_at"]}


@router.delete("/business-entities/{entity_key}/records/{record_id}", status_code=204)
def delete_business_entity_record(
    entity_key: str,
    record_id: UUID,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> None:
    _require_admin(user, connection)
    table_name, _columns = _business_entity_table(connection, entity_key)
    result = connection.execute(
        sql.SQL("DELETE FROM orbit_sales.{} WHERE id = {} RETURNING id").format(sql.Identifier(table_name), sql.Placeholder()),
        (record_id,),
    ).fetchone()
    if result is None:
        raise HTTPException(status_code=404, detail="record not found")


@router.get("/workflow-config/{workflow_key}")
def workflow_config(
    workflow_key: str,
    locale: str = Query(default="en"),
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    definition = connection.execute(
        "SELECT id, name_i18n, group_key, group_name_i18n FROM orbit_workflow.workflow_definition WHERE workflow_key = %s AND is_active",
        (workflow_key,),
    ).fetchone()
    if definition is None:
        raise HTTPException(status_code=404, detail="workflow not found")

    # Keep configuration rows aligned with the current catalog/imported steps.
    connection.execute(
        """
        INSERT INTO orbit_workflow.workflow_step_assignment (workflow_record_id)
        SELECT r.id
          FROM orbit_workflow.workflow_record r
         WHERE r.workflow_id = %s
        ON CONFLICT (workflow_record_id) DO NOTHING
        """,
        (definition["id"],),
    )
    laboratories = connection.execute(
        """
        SELECT id, code, name_i18n
          FROM orbit_identity.laboratory
         WHERE is_active
         ORDER BY code
        """
    ).fetchall()
    business_entities = connection.execute(
        """
        SELECT entity_key, name_i18n
          FROM orbit_sales.business_entity_catalog
         WHERE is_active
         ORDER BY display_order
        """
    ).fetchall()
    steps = connection.execute(
        """
        SELECT r.id, r.record_key, r.record_order, r.label_i18n,
               sla.sla_i18n, sla.sla,
               a.business_entity, a.action, a.sla AS assignment_sla,
               a.laboratory_id, l.code AS laboratory_code, l.name_i18n AS laboratory_name_i18n,
               a.phone_number, a.contact_email, a.contact_name, a.hr_employee_id
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
          JOIN orbit_workflow.workflow_step_assignment a ON a.workflow_record_id = r.id
          LEFT JOIN orbit_identity.laboratory l ON l.id = a.laboratory_id
          LEFT JOIN orbit_workflow.sla_lookup sla
            ON sla.group_name = COALESCE(w.group_name_i18n ->> 'en', w.group_key)
           AND sla.workflow_name = COALESCE(w.name_i18n ->> 'en', w.workflow_key)
           AND sla.record_key = r.record_key
           AND sla.current_workflow_step = COALESCE(r.label_i18n ->> 'en', r.record_key)
           AND sla.is_active
         WHERE r.workflow_id = %s
         ORDER BY r.record_order
        """,
        (definition["id"],),
    ).fetchall()
    return {
        "workflow_key": workflow_key,
        "workflow_name": localized_value(definition["name_i18n"], locale),
        "laboratories": [
            {"id": row["id"], "code": row["code"], "name": localized_value(row["name_i18n"], locale)}
            for row in laboratories
        ],
        "businessEntities": [
            {"key": row["entity_key"], "name": localized_value(row["name_i18n"], "en")}
            for row in business_entities
            if localized_value(row["name_i18n"], "en") in _WORKFLOW_BUSINESS_ENTITIES
        ],
        "steps": [
            {
                "id": row["id"],
                "record_key": row["record_key"],
                "record_order": row["record_order"],
                "step_name": localized_value(row["label_i18n"], locale),
                "sla": row["assignment_sla"] or (localized_value(row["sla_i18n"], locale, row["sla"]) if row["sla"] else None),
                "businessEntity": row["business_entity"],
                "action": row["action"],
                "laboratory_id": row["laboratory_id"],
                "laboratory_code": row["laboratory_code"],
                "laboratory_name": localized_value(row["laboratory_name_i18n"], locale) if row["laboratory_name_i18n"] else None,
                "phone_number": row["phone_number"],
                "contact_email": row["contact_email"],
                "contact_name": row["contact_name"],
                "hr_employee_id": row["hr_employee_id"],
            }
            for row in steps
        ],
    }


@router.patch("/workflow-config/{workflow_key}/steps/{record_id}")
def update_workflow_step(
    workflow_key: str,
    record_id: UUID,
    request: WorkflowStepAssignmentUpdate,
    user: SessionInfo = Depends(get_current_user),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> dict[str, Any]:
    _require_admin(user, connection)
    if request.businessEntity is not None and request.businessEntity not in _WORKFLOW_BUSINESS_ENTITIES:
        raise HTTPException(status_code=422, detail="unsupported business entity")
    updated = connection.execute(
        """
        UPDATE orbit_workflow.workflow_step_assignment a
           SET business_entity = %s,
               action = CASE
                   WHEN %s IS NULL THEN NULL
                   WHEN a.action IS NULL THEN false
                   ELSE a.action
               END,
               sla = %s, laboratory_id = %s, phone_number = %s, contact_email = %s,
               contact_name = %s,
               hr_employee_id = %s, updated_by = %s, updated_at = CURRENT_TIMESTAMP
          FROM orbit_workflow.workflow_record r
          JOIN orbit_workflow.workflow_definition w ON w.id = r.workflow_id
         WHERE a.workflow_record_id = r.id
           AND r.id = %s AND w.workflow_key = %s
         RETURNING a.workflow_record_id
        """,
        (request.businessEntity, request.businessEntity,
         request.sla.strip() if request.sla and request.sla.strip() else None,
         request.laboratory_id, request.phone_number.strip(), request.contact_email.strip(),
         request.contact_name.strip(), request.hr_employee_id, user.user_id, record_id, workflow_key),
    ).fetchone()
    if updated is None:
        raise HTTPException(status_code=404, detail="workflow step not found")
    return {"ok": True, "record_id": updated["workflow_record_id"]}
