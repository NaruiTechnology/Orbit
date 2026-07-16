"""Header identity resolution and workflow authorization."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import Depends, Header, HTTPException, status
from psycopg import Connection

from app.config import get_settings
from app.database import get_connection
from app.schemas import ScopeInfo, SessionInfo
from app.services.localization import localized_value

AccessAction = Literal["view", "edit", "execute"]


def get_current_user(
    locale: str | None = None,
    x_orbit_user: str | None = Header(default=None, alias="X-Orbit-User"),
    connection: Connection[dict[str, Any]] = Depends(get_connection),
) -> SessionInfo:
    login_name = x_orbit_user or get_settings().default_user_login
    row = connection.execute(
        """
        SELECT u.id,
               u.login_name,
               u.display_name_i18n,
               u.preferred_locale,
               m.organization_id,
               o.name_i18n AS organization_name_i18n,
               m.department_id,
               d.name_i18n AS department_name_i18n,
               m.laboratory_id,
               l.name_i18n AS laboratory_name_i18n,
               COALESCE((
                   SELECT jsonb_agg(DISTINCT r.code)
                     FROM orbit_identity.user_role ur
                     JOIN orbit_identity.role r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id
               ), '[]'::jsonb) AS roles,
               COALESCE((
                   SELECT jsonb_agg(DISTINCT p.code)
                     FROM orbit_identity.user_role ur
                     JOIN orbit_identity.role_permission rp ON rp.role_id = ur.role_id
                     JOIN orbit_identity.permission p ON p.id = rp.permission_id
                    WHERE ur.user_id = u.id
               ), '[]'::jsonb) AS permissions
          FROM orbit_identity.app_user u
          JOIN orbit_identity.user_membership m
            ON m.user_id = u.id AND m.is_primary
          JOIN orbit_identity.organization o ON o.id = m.organization_id
          LEFT JOIN orbit_identity.department d ON d.id = m.department_id
          LEFT JOIN orbit_identity.laboratory l ON l.id = m.laboratory_id
         WHERE lower(u.login_name) = lower(%s)
           AND u.is_active
         ORDER BY m.id
         LIMIT 1
        """,
        (login_name,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unknown or inactive Orbit user",
        )
    selected_locale = locale or row["preferred_locale"]
    return SessionInfo(
        user_id=row["id"],
        login_name=row["login_name"],
        display_name=localized_value(row["display_name_i18n"], selected_locale),
        preferred_locale=row["preferred_locale"],
        roles=sorted(row["roles"]),
        permissions=sorted(row["permissions"]),
        scope=ScopeInfo(
            organization_id=row["organization_id"],
            organization_name=localized_value(row["organization_name_i18n"], selected_locale),
            department_id=row["department_id"],
            department_name=localized_value(row["department_name_i18n"], selected_locale)
            if row["department_name_i18n"]
            else None,
            laboratory_id=row["laboratory_id"],
            laboratory_name=localized_value(row["laboratory_name_i18n"], selected_locale)
            if row["laboratory_name_i18n"]
            else None,
        ),
    )


def workflow_access(
    connection: Connection[dict[str, Any]], user_id: Any, workflow_key: str
) -> dict[str, bool] | None:
    return connection.execute(
        """
        SELECT bool_or(a.can_view) AS can_view,
               bool_or(a.can_edit) AS can_edit,
               bool_or(a.can_execute) AS can_execute
          FROM orbit_workflow.workflow_definition w
          JOIN orbit_identity.user_role ur ON ur.user_id = %s
          JOIN orbit_identity.role_workflow_access a ON a.role_id = ur.role_id
         WHERE w.workflow_key = %s
           AND (
               (a.scope_type = 'global' AND a.scope_key = '*')
               OR (a.scope_type = 'group' AND a.scope_key = w.group_key)
               OR (a.scope_type = 'workflow' AND a.scope_key = w.workflow_key)
           )
        """,
        (user_id, workflow_key),
    ).fetchone()


def require_workflow_access(
    connection: Connection[dict[str, Any]],
    user_id: Any,
    workflow_key: str,
    action: AccessAction,
) -> dict[str, bool]:
    access = workflow_access(connection, user_id, workflow_key)
    if access is None or not access.get(f"can_{action}", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Workflow {action} access denied",
        )
    return access
