"""Admin CSV/JSON business report downloads."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from aimtutor.api.routers.auth import require_admin, require_finance_admin
from aimtutor.multi_user.identity import list_user_info
from aimtutor.services.reports import (
    ACTIVITY_COLUMNS,
    AI_USAGE_COLUMNS,
    REVENUE_COLUMNS,
    USER_COLUMNS,
    fetch_activity_report_sync,
    fetch_ai_usage_report_sync,
    fetch_revenue_report_sync,
    fetch_users_report_sync,
    iter_csv,
)

router = APIRouter()


def _csv_response(rows: list[dict[str, Any]], columns: list[str], filename: str) -> StreamingResponse:
    return StreamingResponse(
        iter_csv(rows, columns),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _legacy_csv_response(rows: list[dict[str, Any]], filename: str) -> StreamingResponse:
    if not rows:
        rows = [{}]
    columns = list(rows[0].keys())
    return _csv_response(rows, columns, filename)


@router.get("/admin/reports/users")
async def export_users_report(
    format: str = Query(default="csv", alias="format"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    plan: str | None = Query(default=None),
    status: str | None = Query(default=None),
    _: Any = Depends(require_admin),
) -> Any:
    rows = await asyncio.to_thread(
        fetch_users_report_sync,
        date_from=date_from,
        date_to=date_to,
        plan=plan,
        status=status,
    )
    if format == "json":
        return {"rows": rows, "count": len(rows)}
    today = date.today().isoformat()
    return _csv_response(rows, USER_COLUMNS, f"users-{today}.csv")


@router.get("/admin/reports/revenue")
async def export_revenue_report(
    format: str = Query(default="csv", alias="format"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    _: Any = Depends(require_finance_admin),
) -> Any:
    rows = await asyncio.to_thread(
        fetch_revenue_report_sync,
        date_from=date_from,
        date_to=date_to,
    )
    if format == "json":
        return {"rows": rows, "count": len(rows)}
    today = date.today().isoformat()
    return _csv_response(rows, REVENUE_COLUMNS, f"revenue-{today}.csv")


@router.get("/admin/reports/ai-usage")
async def export_ai_usage_report(
    format: str = Query(default="csv", alias="format"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    period: str | None = Query(default=None),
    _: Any = Depends(require_admin),
) -> Any:
    rows = await asyncio.to_thread(
        fetch_ai_usage_report_sync,
        date_from=date_from,
        date_to=date_to,
        period=period,
    )
    if format == "json":
        return {"rows": rows, "count": len(rows)}
    today = date.today().isoformat()
    return _csv_response(rows, AI_USAGE_COLUMNS, f"ai-usage-{today}.csv")


@router.get("/admin/reports/activity")
async def export_activity_report(
    format: str = Query(default="csv", alias="format"),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    _: Any = Depends(require_admin),
) -> Any:
    rows = await asyncio.to_thread(
        fetch_activity_report_sync,
        date_from=date_from,
        date_to=date_to,
    )
    if format == "json":
        return {"rows": rows, "count": len(rows)}
    today = date.today().isoformat()
    return _csv_response(rows, ACTIVITY_COLUMNS, f"activity-{today}.csv")


@router.get("/admin/reports/plans")
async def export_plans_report(
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    from aimtutor.services.quota import list_plans

    plans = await list_plans()
    rows = [
        {
            "plan_id": p.get("id", ""),
            "name": p.get("name", ""),
            "display_name": p.get("display_name", ""),
            "price_monthly": p.get("price_monthly", 0),
            "price_yearly": p.get("price_yearly", 0),
            "active_users": p.get("user_count", 0),
            "chat_messages": p.get("chat_messages", 0),
            "voice_minutes": p.get("voice_minutes", 0),
            "is_active": p.get("is_active", True),
        }
        for p in plans
    ]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _legacy_csv_response(rows, f"plans-{stamp}.csv")


@router.get("/admin/reports/usage")
async def export_usage_report(
    period: str | None = None,
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    period_key = period or datetime.now(timezone.utc).strftime("%Y-%m")

    def _fetch() -> list[dict[str, Any]]:
        from aimtutor.services.db import connect

        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT user_id, metric, SUM(value) AS total
                FROM usage_records
                WHERE period_key = %s
                GROUP BY user_id, metric
                ORDER BY user_id, metric
                """,
                (period_key,),
            )
            return [dict(row) for row in cur.fetchall()]

    try:
        records = await asyncio.to_thread(_fetch)
    except Exception:
        records = []

    users_by_id = {u.get("id", ""): u.get("username", "") for u in list_user_info()}
    rows = [
        {
            "user_id": r.get("user_id", ""),
            "username": users_by_id.get(str(r.get("user_id", "")), ""),
            "metric": r.get("metric", ""),
            "total_used": float(r.get("total") or 0),
            "period": period_key,
        }
        for r in records
    ]
    return _legacy_csv_response(rows, f"usage-{period_key}.csv")


@router.get("/admin/reports/audit")
async def export_audit_report(
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    from aimtutor.multi_user.audit import get_audit_log

    entries = get_audit_log(limit=2000)
    rows = [
        {
            "timestamp": e.get("ts", e.get("time", "")),
            "action": e.get("action", ""),
            "admin_id": e.get("admin_id", e.get("actor_id", "")),
            "target_user_id": e.get("target_user_id", ""),
            "summary": str(e.get("summary", "")),
        }
        for e in entries
    ]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _legacy_csv_response(rows, f"audit-{stamp}.csv")
