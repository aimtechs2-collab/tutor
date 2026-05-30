"""Natural-language admin intelligence agent with tool-backed platform queries."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from aimtutor.api.routers.auth import require_admin, require_ai_safety
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.multi_user.flagged_conversations import list_unresolved_flags
from aimtutor.multi_user.identity import get_user_by_id, list_user_info
from aimtutor.services.db import connect

logger = logging.getLogger(__name__)

router = APIRouter()

AGENT_MODEL = "claude-sonnet-4-20250514"
MAX_TOOL_ROUNDS = 6

AGENT_TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_users",
        "description": "Search users by name or filter by plan/status",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "plan": {"type": "string"},
                "status": {"type": "string"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_user_stats",
        "description": "Get activity and usage stats for a specific user",
        "input_schema": {
            "type": "object",
            "properties": {"user_id": {"type": "string"}},
            "required": ["user_id"],
        },
    },
    {
        "name": "get_revenue_summary",
        "description": "Get revenue, MRR, payment stats for a period",
        "input_schema": {
            "type": "object",
            "properties": {"period_key": {"type": "string"}},
        },
    },
    {
        "name": "get_risk_summary",
        "description": "Get count of flagged/risky users and unresolved flags",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_ai_cost_summary",
        "description": "Get AI API cost breakdown for a billing period",
        "input_schema": {
            "type": "object",
            "properties": {"period_key": {"type": "string"}},
        },
    },
]


class ChatRequest(BaseModel):
    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)


class RiskReviewRequest(BaseModel):
    status: str
    note: str = ""

    @field_validator("status")
    @classmethod
    def status_valid(cls, value: str) -> str:
        allowed = {"reviewed", "dismissed", "actioned"}
        if value not in allowed:
            raise ValueError(f"status must be one of {sorted(allowed)}")
        return value


def _anthropic_api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


def _current_period_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _user_plan_map_sync() -> dict[str, dict[str, str]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.user_id, pl.name, pl.display_name
            FROM subscriptions s
            JOIN plans pl ON pl.id = s.plan_id
            WHERE s.status = 'active'
            """
        )
        rows = cur.fetchall()
    return {
        str(row["user_id"]): {
            "plan_name": str(row["name"]),
            "plan_display": str(row["display_name"]),
        }
        for row in rows
    }


def _period_revenue_sync(period_key: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS revenue_paise,
                COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS refunded_paise
            FROM payments
            WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = %s
            """,
            (period_key,),
        )
        row = dict(cur.fetchone())
        cur.execute(
            """
            SELECT COALESCE(SUM(p.price_monthly), 0) AS mrr_inr,
                   COUNT(*) AS active_subscriptions
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active'
            """
        )
        subs = dict(cur.fetchone())
    return {
        "period_key": period_key,
        "revenue_paise": int(row["revenue_paise"]),
        "paid_count": int(row["paid_count"]),
        "refunded_paise": int(row["refunded_paise"]),
        "mrr_inr": float(subs["mrr_inr"]),
        "active_subscriptions": int(subs["active_subscriptions"]),
    }


async def _stats_for_user(user_id: str, username: str, record: dict[str, Any]) -> dict[str, Any]:
    from aimtutor.services.cost_tracker import current_period_key, get_user_cost_summary
    from aimtutor.services.quota import get_full_usage_summary

    period_key = current_period_key()
    usage, costs = await asyncio.gather(
        get_full_usage_summary(user_id),
        get_user_cost_summary(user_id, period_key),
    )
    plan_map = await asyncio.to_thread(_user_plan_map_sync)
    plan = plan_map.get(user_id, {"plan_name": usage.get("plan_name", "free"), "plan_display": usage.get("plan_display", "Free")})
    return {
        "user_id": user_id,
        "username": username,
        "role": record.get("role"),
        "admin_role": record.get("admin_role"),
        "disabled": bool(record.get("disabled", False)),
        "banned": bool(record.get("banned", False)),
        "created_at": record.get("created_at"),
        "plan": plan,
        "usage": usage,
        "ai_costs": costs,
    }


async def _platform_overview() -> dict[str, Any]:
    users = list_user_info()
    active = [user for user in users if not user.get("disabled") and not user.get("banned")]
    plan_map = await asyncio.to_thread(_user_plan_map_sync)
    return {
        "total_users": len(users),
        "active_users": len(active),
        "admin_staff": sum(1 for user in users if user.get("role") == "admin"),
        "suspended_users": sum(1 for user in users if user.get("disabled")),
        "banned_users": sum(1 for user in users if user.get("banned")),
        "paid_subscribers": len(plan_map),
    }


async def _execute_tool(name: str, inputs: dict[str, Any]) -> str:
    """Execute a tool and return a JSON string for the agent."""
    try:
        if name == "search_users":
            users = list_user_info()
            plan_map = await asyncio.to_thread(_user_plan_map_sync)
            query = str(inputs.get("query") or "").lower().strip()
            plan_filter = str(inputs.get("plan") or "").lower().strip()
            status_filter = str(inputs.get("status") or "").lower().strip()

            results: list[dict[str, Any]] = []
            for user in users:
                username = str(user.get("username") or "")
                if query and query not in username.lower() and query not in str(user.get("id") or "").lower():
                    continue
                plan_info = plan_map.get(str(user.get("id") or ""), {"plan_name": "free", "plan_display": "Free"})
                if plan_filter and plan_filter not in plan_info["plan_name"].lower() and plan_filter not in plan_info["plan_display"].lower():
                    continue
                if status_filter:
                    if status_filter in {"active", "enabled"} and (user.get("disabled") or user.get("banned")):
                        continue
                    if status_filter in {"suspended", "disabled"} and not user.get("disabled"):
                        continue
                    if status_filter == "banned" and not user.get("banned"):
                        continue
                results.append(
                    {
                        "id": user.get("id"),
                        "username": username,
                        "role": user.get("role"),
                        "disabled": user.get("disabled"),
                        "banned": user.get("banned"),
                        "plan_name": plan_info["plan_name"],
                        "plan_display": plan_info["plan_display"],
                    }
                )
            return json.dumps(results[:10], default=str)

        if name == "get_user_stats":
            user_id = str(inputs.get("user_id") or "").strip()
            result = get_user_by_id(user_id)
            if not result:
                return json.dumps({"error": "User not found"})
            username, record = result
            stats = await _stats_for_user(user_id, username, dict(record))
            return json.dumps(stats, default=str)

        if name == "get_revenue_summary":
            from aimtutor.services.cost_tracker import get_platform_cost_summary

            period_key = str(inputs.get("period_key") or _current_period_key())
            revenue, platform = await asyncio.gather(
                asyncio.to_thread(_period_revenue_sync, period_key),
                get_platform_cost_summary(period_key),
            )
            payload = {
                **revenue,
                "ai_cost_usd": platform.get("total_cost_usd", 0.0),
                "profit_usd": platform.get("profit_usd", 0.0),
                "mrr_vs_cost_usd": platform.get("mrr_vs_cost_usd", 0.0),
            }
            return json.dumps(payload, default=str)

        if name == "get_risk_summary":
            from aimtutor.services.risk_agent import get_risk_summary

            summary = await get_risk_summary()
            unresolved = await list_unresolved_flags()
            return json.dumps(
                {
                    **summary,
                    "unresolved_conversation_flags": len(unresolved),
                },
                default=str,
            )

        if name == "get_ai_cost_summary":
            from aimtutor.services.cost_tracker import get_cost_per_user, get_platform_cost_summary

            period_key = str(inputs.get("period_key") or _current_period_key())
            platform, top_users = await asyncio.gather(
                get_platform_cost_summary(period_key),
                get_cost_per_user(period_key, limit=10),
            )
            return json.dumps(
                {
                    "platform": platform,
                    "top_users": top_users,
                },
                default=str,
            )

        return json.dumps({"error": f"Unknown tool: {name}"})
    except Exception as exc:
        logger.debug("admin_agent tool %s failed: %s", name, exc)
        return json.dumps({"error": f"Tool error: {exc}"})


def _normalize_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for item in history[-20:]:
        role = str(item.get("role") or "").strip()
        content = item.get("content")
        if role not in {"user", "assistant"}:
            continue
        if isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})
    return messages


def _extract_text(response: anthropic.types.Message) -> str:
    parts = [block.text for block in response.content if block.type == "text"]
    return "\n".join(part for part in parts if part).strip()


async def _run_agent(system: str, messages: list[dict[str, Any]]) -> tuple[str, list[str]]:
    api_key = _anthropic_api_key()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ANTHROPIC_API_KEY is not configured for the admin intelligence agent.",
        )

    client = anthropic.AsyncAnthropic(api_key=api_key)
    tool_calls_made: list[str] = []
    response = await client.messages.create(
        model=AGENT_MODEL,
        max_tokens=1000,
        system=system,
        messages=messages,
        tools=AGENT_TOOLS,
    )

    rounds = 0
    while response.stop_reason == "tool_use" and rounds < MAX_TOOL_ROUNDS:
        rounds += 1
        tool_results: list[dict[str, Any]] = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            tool_input = block.input if isinstance(block.input, dict) else {}
            result = await _execute_tool(block.name, tool_input)
            tool_calls_made.append(block.name)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                }
            )
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})
        response = await client.messages.create(
            model=AGENT_MODEL,
            max_tokens=1000,
            system=system,
            messages=messages,
            tools=AGENT_TOOLS,
        )

    return _extract_text(response) or "I couldn't generate a response.", tool_calls_made


@router.post("/api/v1/admin/agent/chat")
async def admin_agent_chat(
    body: ChatRequest,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    overview = await _platform_overview()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    period_key = _current_period_key()

    system = f"""You are the AIMTutor Admin Intelligence Agent. Today is {today}.

LIVE PLATFORM DATA:
- Total users: {overview["total_users"]}
- Active users: {overview["active_users"]}
- Admin/staff: {overview["admin_staff"]}
- Suspended users: {overview["suspended_users"]}
- Banned users: {overview["banned_users"]}
- Paid subscribers: {overview["paid_subscribers"]}
- Current billing period: {period_key}

Answer admin questions using this data and the available tools.
Be concise. Cite specific numbers. If you need more data, use a tool.
When comparing revenue and AI cost, note revenue is in INR (paise) and AI cost is estimated in USD."""

    messages = _normalize_history(body.history)
    messages.append({"role": "user", "content": body.message.strip()})

    try:
        text, tool_calls_made = await _run_agent(system, messages)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Admin intelligence agent failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Admin agent failed: {exc}",
        ) from exc

    return {"response": text, "tool_calls_made": tool_calls_made}


@router.get("/api/v1/admin/risk/summary")
async def admin_risk_summary(_: Any = Depends(require_ai_safety)) -> dict[str, Any]:
    from aimtutor.services.risk_agent import get_risk_summary

    return await get_risk_summary()


@router.get("/api/v1/admin/risk/flags")
async def admin_risk_flags(
    severity: str | None = None,
    risk_type: str | None = None,
    status: str | None = None,
    limit: int = 100,
    _: Any = Depends(require_ai_safety),
) -> dict[str, Any]:
    from aimtutor.services.risk_agent import list_risk_flags

    flags = await list_risk_flags(
        severity=severity,
        risk_type=risk_type,
        status=status,
        limit=limit,
    )
    return {"flags": flags}


@router.post("/api/v1/admin/risk/flags/{flag_id}/review")
async def admin_risk_review_flag(
    flag_id: str,
    body: RiskReviewRequest,
    _: Any = Depends(require_ai_safety),
) -> dict[str, Any]:
    from aimtutor.services.risk_agent import review_risk_flag

    actor = get_current_user()
    updated = await review_risk_flag(
        flag_id=flag_id,
        status=body.status,
        reviewed_by=actor.id,
        review_note=body.note,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk flag not found")
    log_admin_action(
        "review_risk_flag",
        target_user_id=str(updated.get("user_id") or ""),
        summary={
            "flag_id": flag_id,
            "status": body.status,
            "risk_type": updated.get("risk_type"),
            "note": body.note,
        },
    )
    return {"ok": True, "flag": updated}


@router.post("/api/v1/admin/risk/scan")
async def admin_risk_scan(_: Any = Depends(require_ai_safety)) -> dict[str, bool]:
    from aimtutor.services.risk_agent import run_risk_scan

    asyncio.create_task(run_risk_scan())
    return {"started": True}
