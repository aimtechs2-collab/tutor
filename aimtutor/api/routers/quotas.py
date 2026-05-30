from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from aimtutor.api.routers.auth import require_finance_admin, require_auth
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.services.quota import (
    assign_plan_to_user,
    create_plan,
    deactivate_plan,
    get_full_usage_summary,
    get_plan,
    list_plan_users,
    list_plans,
    record_usage,
    update_plan,
)

router = APIRouter()


@router.get("/me")
async def my_quota(_: Any = Depends(require_auth)) -> dict:
    from aimtutor.multi_user.context import get_current_user

    user = get_current_user()
    return await get_full_usage_summary(user.id)


@router.get("/admin/users/{user_id}")
async def admin_user_quota(user_id: str, _: Any = Depends(require_finance_admin)) -> dict:
    return await get_full_usage_summary(user_id)


class QuotaAdjustRequest(BaseModel):
    metric: str
    delta: float
    reason: str = ""


@router.post("/admin/users/{user_id}/adjust")
async def admin_adjust_quota(
    user_id: str, body: QuotaAdjustRequest, _: Any = Depends(require_finance_admin)
) -> dict:
    await record_usage(user_id, body.metric, body.delta)
    log_admin_action(
        "quota_adjust",
        target_user_id=user_id,
        summary={"metric": body.metric, "delta": body.delta, "reason": body.reason},
    )
    return {"ok": True}


class PlanWriteRequest(BaseModel):
    name: str
    display_name: str
    price_monthly: float = 0
    price_yearly: float = 0
    chat_messages: int = 100
    voice_minutes: int = 10
    quiz_generations: int = 5
    kb_uploads: int = 3

    @field_validator("name")
    @classmethod
    def name_valid(cls, value: str) -> str:
        slug = value.strip().lower()
        if not slug:
            raise ValueError("Plan name is required")
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789-_")
        if not all(ch in allowed for ch in slug):
            raise ValueError("Plan name must be a lowercase slug")
        return slug

    @field_validator("display_name")
    @classmethod
    def display_name_valid(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Display name is required")
        return cleaned


class AssignPlanRequest(BaseModel):
    plan_id: str
    expires_at: str | None = None


def _plan_payload(body: PlanWriteRequest) -> dict[str, Any]:
    return {
        "name": body.name,
        "display_name": body.display_name,
        "price_monthly": body.price_monthly,
        "price_yearly": body.price_yearly,
        "chat_messages": body.chat_messages,
        "voice_minutes": body.voice_minutes,
        "quiz_generations": body.quiz_generations,
        "kb_uploads": body.kb_uploads,
    }


def _parse_expires_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expires_at must be an ISO-8601 datetime",
        ) from exc


@router.get("/admin/plans")
async def admin_list_plans(_: Any = Depends(require_finance_admin)) -> list[dict]:
    return await list_plans()


@router.post("/admin/plans", status_code=status.HTTP_201_CREATED)
async def admin_create_plan(body: PlanWriteRequest, _: Any = Depends(require_finance_admin)) -> dict:
    try:
        plan = await create_plan(_plan_payload(body))
    except Exception as exc:
        message = str(exc)
        if "unique" in message.lower() or "duplicate" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A plan with this name already exists",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create plan",
        ) from exc
    log_admin_action(
        "create_plan",
        summary={"plan_id": plan["id"], "name": plan["name"]},
    )
    return plan


@router.put("/admin/plans/{plan_id}")
async def admin_update_plan(
    plan_id: str, body: PlanWriteRequest, _: Any = Depends(require_finance_admin)
) -> dict:
    updated = await update_plan(plan_id, _plan_payload(body))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    log_admin_action(
        "update_plan",
        summary={"plan_id": plan_id, "name": updated["name"]},
    )
    return updated


@router.delete("/admin/plans/{plan_id}")
async def admin_deactivate_plan(plan_id: str, _: Any = Depends(require_finance_admin)) -> dict:
    plan = await get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    deactivated = await deactivate_plan(plan_id)
    if not deactivated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    log_admin_action(
        "deactivate_plan",
        summary={"plan_id": plan_id, "name": plan["name"]},
    )
    return {"ok": True}


@router.post("/admin/users/{user_id}/assign-plan")
async def admin_assign_plan(
    user_id: str, body: AssignPlanRequest, _: Any = Depends(require_finance_admin)
) -> dict:
    expires_at = _parse_expires_at(body.expires_at)
    try:
        assignment = await assign_plan_to_user(user_id, body.plan_id, expires_at)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign plan",
        ) from exc
    log_admin_action(
        "assign_plan",
        target_user_id=user_id,
        summary={
            "plan_id": body.plan_id,
            "expires_at": body.expires_at,
            "assignment_id": assignment["id"],
        },
    )
    return {"ok": True, "assignment": assignment}


@router.get("/admin/plans/{plan_id}/users")
async def admin_plan_users(plan_id: str, _: Any = Depends(require_finance_admin)) -> list[dict]:
    plan = await get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return await list_plan_users(plan_id)
