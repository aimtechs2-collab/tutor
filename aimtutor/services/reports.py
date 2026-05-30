"""Admin CSV/JSON report exports."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Iterator

from aimtutor.services.cost_tracker import current_period_key
from aimtutor.services.db import connect
from aimtutor.services.quota import _get_user_plan_limits_sync


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if hasattr(value, "isoformat"):
        return str(value.isoformat())
    return str(value or "")


def _user_status(row: dict[str, Any]) -> str:
    if row.get("banned"):
        return "banned"
    if row.get("suspended_at"):
        return "suspended"
    if row.get("disabled"):
        return "disabled"
    return "active"


def _user_metrics_sync(user_id: str, period_key: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(value), 0) AS total
            FROM usage_records
            WHERE user_id = %s AND metric = 'quiz_generations' AND period_key = %s
            """,
            (user_id, period_key),
        )
        quiz_sessions = float(cur.fetchone()["total"])
        cur.execute(
            """
            SELECT COALESCE(SUM(value), 0) AS total
            FROM usage_records
            WHERE user_id = %s AND metric = 'voice_minutes' AND period_key = %s
            """,
            (user_id, period_key),
        )
        voice_minutes = float(cur.fetchone()["total"])
        cur.execute(
            """
            SELECT COUNT(DISTINCT session_id) AS total
            FROM ai_cost_records
            WHERE user_id = %s AND session_id IS NOT NULL
            """,
            (user_id,),
        )
        total_sessions = int(cur.fetchone()["total"])
        cur.execute(
            """
            SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost
            FROM ai_cost_records
            WHERE user_id = %s AND period_key = %s
            """,
            (user_id, period_key),
        )
        monthly_ai_cost = float(cur.fetchone()["cost"])
    return {
        "total_sessions": total_sessions,
        "quiz_sessions": int(quiz_sessions),
        "voice_minutes": round(voice_minutes, 1),
        "monthly_ai_cost": round(monthly_ai_cost, 6),
    }


def fetch_users_report_sync(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    plan: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if date_from:
        clauses.append("au.created_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        clauses.append("au.created_at <= %s::timestamptz")
        params.append(date_to)
    if plan:
        clauses.append("COALESCE(p.name, 'free') = %s")
        params.append(plan)
    if status == "active":
        clauses.append("COALESCE(au.disabled, false) = false AND au.suspended_at IS NULL AND COALESCE(au.banned, false) = false")
    elif status == "disabled":
        clauses.append("au.disabled = true")
    elif status == "suspended":
        clauses.append("au.suspended_at IS NOT NULL")
    elif status == "banned":
        clauses.append("au.banned = true")

    period_key = current_period_key()
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT au.id, au.username, au.role, au.created_at,
                   au.disabled, au.suspended_at, au.banned,
                   COALESCE(p.name, 'free') AS plan
            FROM auth_users au
            LEFT JOIN user_plans up ON up.user_id = au.id AND up.status = 'active'
            LEFT JOIN plans p ON p.id = up.plan_id
            WHERE {' AND '.join(clauses)}
            ORDER BY au.created_at DESC
            """,
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]

    results: list[dict[str, Any]] = []
    for row in rows:
        user_id = str(row["id"])
        metrics = _user_metrics_sync(user_id, period_key)
        results.append(
            {
                "id": user_id,
                "username": str(row["username"]),
                "role": str(row.get("role") or "user"),
                "plan": str(row.get("plan") or "free"),
                "status": _user_status(row),
                "joined_date": _iso(row.get("created_at")),
                **metrics,
            }
        )
    return results


def fetch_revenue_report_sync(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if date_from:
        clauses.append("p.created_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        clauses.append("p.created_at <= %s::timestamptz")
        params.append(date_to)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT p.created_at, p.user_id, au.username,
                   COALESCE(pl.name, '') AS plan,
                   p.amount, p.status, p.id AS payment_id
            FROM payments p
            LEFT JOIN auth_users au ON au.id = p.user_id
            LEFT JOIN plans pl ON pl.id = p.plan_id
            WHERE {' AND '.join(clauses)}
            ORDER BY p.created_at DESC
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [
        {
            "date": _iso(row["created_at"]),
            "user_id": str(row["user_id"]),
            "username": str(row.get("username") or ""),
            "plan": str(row.get("plan") or ""),
            "amount_inr": round(int(row["amount"]) / 100.0, 2),
            "status": str(row["status"]),
            "payment_id": str(row["payment_id"]),
        }
        for row in rows
    ]


def fetch_ai_usage_report_sync(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    period: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if period:
        clauses.append("acr.period_key = %s")
        params.append(period)
    if date_from:
        clauses.append("acr.created_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        clauses.append("acr.created_at <= %s::timestamptz")
        params.append(date_to)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT acr.user_id, au.username, acr.capability, acr.model,
                   COALESCE(SUM(acr.input_tokens + acr.output_tokens), 0) AS tokens,
                   COALESCE(SUM(acr.estimated_cost_usd), 0) AS cost_usd,
                   acr.period_key
            FROM ai_cost_records acr
            LEFT JOIN auth_users au ON au.id = acr.user_id
            WHERE {' AND '.join(clauses)}
            GROUP BY acr.user_id, au.username, acr.capability, acr.model, acr.period_key
            ORDER BY cost_usd DESC
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        user_id = str(row["user_id"])
        plan = _get_user_plan_limits_sync(user_id).get("plan_name", "free")
        results.append(
            {
                "user_id": user_id,
                "username": str(row.get("username") or ""),
                "plan": str(plan),
                "capability": str(row["capability"]),
                "model": str(row["model"]),
                "tokens": int(row["tokens"]),
                "cost_usd": round(float(row["cost_usd"]), 6),
                "period": str(row["period_key"]),
            }
        )
    return results


def fetch_activity_report_sync(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if date_from:
        clauses.append("e.created_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        clauses.append("e.created_at <= %s::timestamptz")
        params.append(date_to)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT e.created_at, e.user_id, au.username, e.ip_address, e.user_agent, e.country
            FROM user_login_events e
            LEFT JOIN auth_users au ON au.id = e.user_id
            WHERE {' AND '.join(clauses)}
            ORDER BY e.created_at DESC
            LIMIT 5000
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [
        {
            "timestamp": _iso(row["created_at"]),
            "user_id": str(row["user_id"]),
            "username": str(row.get("username") or ""),
            "action": "login",
            "ip_address": str(row.get("ip_address") or ""),
            "country": str(row.get("country") or ""),
        }
        for row in rows
    ]


USER_COLUMNS = [
    "id",
    "username",
    "role",
    "plan",
    "status",
    "joined_date",
    "total_sessions",
    "quiz_sessions",
    "voice_minutes",
    "monthly_ai_cost",
]
REVENUE_COLUMNS = ["date", "user_id", "username", "plan", "amount_inr", "status", "payment_id"]
AI_USAGE_COLUMNS = ["user_id", "username", "plan", "capability", "model", "tokens", "cost_usd", "period"]
ACTIVITY_COLUMNS = ["timestamp", "user_id", "username", "action", "ip_address", "country"]


def iter_csv(rows: list[dict[str, Any]], columns: list[str]) -> Iterator[str]:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)
    for row in rows:
        writer.writerow([row.get(col, "") for col in columns])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
