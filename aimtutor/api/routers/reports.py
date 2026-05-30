"""Admin report export endpoints — CSV downloads."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from aimtutor.api.routers.auth import require_finance_admin
from aimtutor.multi_user.identity import list_user_info

router = APIRouter()


def _csv_response(rows: list[dict[str, Any]], filename: str) -> StreamingResponse:
    if not rows:
        rows = [{}]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/admin/reports/users")
async def export_users_report(
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    """Export all users as CSV."""
    users = list_user_info()
    rows = [
        {
            "id": u.get("id", ""),
            "username": u.get("username", ""),
            "role": u.get("role", "user"),
            "status": "banned" if u.get("banned") else "suspended" if u.get("disabled") else "active",
            "joined": str(u.get("created_at", ""))[:10],
            "suspension_reason": u.get("suspension_reason", ""),
            "ban_reason": u.get("ban_reason", ""),
        }
        for u in users
    ]
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"users-{date}.csv")


@router.get("/admin/reports/plans")
async def export_plans_report(
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    """Export plan & subscription data as CSV."""
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
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"plans-{date}.csv")


@router.get("/admin/reports/usage")
async def export_usage_report(
    period: str | None = None,
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    """Export usage records for a given month (YYYY-MM, default current)."""
    import asyncio
    period_key = period or datetime.now(timezone.utc).strftime("%Y-%m")

    def _fetch():
        from aimtutor.services.db import connect
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, metric, SUM(value) AS total "
                "FROM usage_records WHERE period_key=%s "
                "GROUP BY user_id, metric ORDER BY user_id, metric",
                (period_key,),
            )
            return [dict(r) for r in cur.fetchall()]

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
    return _csv_response(rows, f"usage-{period_key}.csv")


@router.get("/admin/reports/audit")
async def export_audit_report(
    _: Any = Depends(require_finance_admin),
) -> StreamingResponse:
    """Export the full admin audit log as CSV."""
    from aimtutor.multi_user.audit import get_audit_log
    entries = get_audit_log(limit=2000)
    rows = [
        {
            "timestamp": e.get("ts", ""),
            "action": e.get("action", ""),
            "admin_id": e.get("admin_id", ""),
            "target_user_id": e.get("target_user_id", ""),
            "summary": str(e.get("summary", "")),
        }
        for e in entries
    ]
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return _csv_response(rows, f"audit-{date}.csv")
