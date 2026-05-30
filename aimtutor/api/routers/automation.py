"""Admin automation rule management."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from aimtutor.api.routers.auth import require_admin
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.services.automation_engine import (
    ACTIONS,
    TRIGGERS,
    create_rule_sync,
    delete_rule_sync,
    get_rule_sync,
    list_logs,
    list_rules,
    run_automation_cycle,
    toggle_rule_sync,
    update_rule_sync,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class AutomationRulePayload(BaseModel):
    name: str
    description: str = ""
    enabled: bool = True
    trigger: dict[str, Any]
    actions: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("trigger")
    @classmethod
    def trigger_valid(cls, value: dict[str, Any]) -> dict[str, Any]:
        trigger_type = str(value.get("type") or "")
        if trigger_type not in TRIGGERS:
            raise ValueError(f"trigger.type must be one of {sorted(TRIGGERS)}")
        return value

    @field_validator("actions")
    @classmethod
    def actions_valid(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not value:
            raise ValueError("At least one action is required")
        for action in value:
            action_type = str(action.get("type") or "")
            if action_type not in ACTIONS:
                raise ValueError(f"Unknown action type: {action_type}")
        return value


@router.get("/rules")
async def automation_list_rules(_: Any = Depends(require_admin)) -> dict[str, Any]:
    rules = await list_rules()
    return {"rules": rules}


@router.post("/rules")
async def automation_create_rule(
    body: AutomationRulePayload,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    actor = get_current_user()
    rule = await asyncio.to_thread(
        create_rule_sync,
        name=body.name.strip(),
        description=body.description.strip(),
        enabled=body.enabled,
        trigger=body.trigger,
        actions=body.actions,
        created_by=actor.id,
    )
    log_admin_action(
        "automation_rule_create",
        summary={"rule_id": rule["id"], "name": rule["name"], "trigger": rule["trigger"]},
    )
    return {"rule": rule}


@router.put("/rules/{rule_id}")
async def automation_update_rule(
    rule_id: str,
    body: AutomationRulePayload,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    updated = await asyncio.to_thread(
        update_rule_sync,
        rule_id,
        name=body.name.strip(),
        description=body.description.strip(),
        enabled=body.enabled,
        trigger=body.trigger,
        actions=body.actions,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    log_admin_action(
        "automation_rule_update",
        summary={"rule_id": rule_id, "name": updated["name"]},
    )
    return {"rule": updated}


@router.delete("/rules/{rule_id}")
async def automation_delete_rule(
    rule_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, bool]:
    deleted = await asyncio.to_thread(delete_rule_sync, rule_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    log_admin_action("automation_rule_delete", summary={"rule_id": rule_id})
    return {"ok": True}


@router.post("/rules/{rule_id}/toggle")
async def automation_toggle_rule(
    rule_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    updated = await asyncio.to_thread(toggle_rule_sync, rule_id)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    log_admin_action(
        "automation_rule_toggle",
        summary={"rule_id": rule_id, "enabled": updated["enabled"]},
    )
    return {"rule": updated}


@router.post("/rules/{rule_id}/run-now")
async def automation_run_rule_now(
    rule_id: str,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    rule = await asyncio.to_thread(get_rule_sync, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    actions_taken = await run_automation_cycle(rule_id)
    log_admin_action(
        "automation_rule_run",
        summary={"rule_id": rule_id, "actions_taken": actions_taken},
    )
    return {"ok": True, "actions_taken": actions_taken}


@router.get("/logs")
async def automation_logs(
    rule_id: str | None = None,
    limit: int = 100,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    logs = await list_logs(rule_id=rule_id, limit=max(1, min(limit, 500)))
    return {"logs": logs}
