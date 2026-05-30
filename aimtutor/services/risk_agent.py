"""Automated detection of suspicious user behavior."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from aimtutor.multi_user.identity import list_user_info
from aimtutor.services.db import connect
from aimtutor.services.quota import _get_user_plan_limits_sync, _get_usage_sync

logger = logging.getLogger(__name__)

EXCESSIVE_USAGE_THRESHOLD = 100
ACCOUNT_SHARING_IP_THRESHOLD = 3
TRIAL_ABUSE_RATIO = 1.5
TRIAL_ABUSE_MIN_METRICS = 2

RISK_CHECKS = (
    "check_excessive_usage",
    "check_account_sharing",
    "check_trial_abuse",
)


def _current_period_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _row_to_flag(row: dict[str, Any]) -> dict[str, Any]:
    details = row.get("details")
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except json.JSONDecodeError:
            details = {}
    elif details is None:
        details = {}
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "risk_type": str(row["risk_type"]),
        "severity": str(row["severity"]),
        "details": details,
        "status": str(row.get("status") or "open"),
        "reviewed_by": str(row["reviewed_by"]) if row.get("reviewed_by") else None,
        "review_note": str(row.get("review_note") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }


def _usage_last_hour_sync(user_id: str, metric: str) -> float:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(value), 0) AS total
            FROM usage_records
            WHERE user_id = %s
              AND metric = %s
              AND created_at >= now() - interval '1 hour'
            """,
            (user_id, metric),
        )
        row = cur.fetchone()
    return float(row["total"] if row else 0)


def _distinct_ips_last_day_sync(user_id: str) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(DISTINCT ip_address) AS ip_count
            FROM user_login_events
            WHERE user_id = %s
              AND success = TRUE
              AND created_at >= now() - interval '24 hours'
            """,
            (user_id,),
        )
        row = cur.fetchone()
    return int(row["ip_count"] if row else 0)


def _has_open_flag_sync(user_id: str, risk_type: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM user_risk_flags
            WHERE user_id = %s AND risk_type = %s AND status = 'open'
            LIMIT 1
            """,
            (user_id, risk_type),
        )
        return cur.fetchone() is not None


def _create_flag_sync(
    *,
    user_id: str,
    risk_type: str,
    severity: str,
    details: dict[str, Any],
) -> dict[str, Any]:
    flag_id = f"risk_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_risk_flags (
                id, user_id, risk_type, severity, details, status, review_note, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, 'open', '', now(), now())
            RETURNING id, user_id, risk_type, severity, details, status, reviewed_by, review_note, created_at, updated_at
            """,
            (flag_id, user_id, risk_type, severity, json.dumps(details)),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _row_to_flag(row)


def record_login_event_sync(
    *,
    user_id: str,
    ip_address: str,
    user_agent: str = "",
    country: str | None = None,
    city: str | None = None,
    success: bool = True,
) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_login_events (
                id, user_id, ip_address, user_agent, country, city, success, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, now())
            """,
            (
                f"login_{uuid4().hex}",
                user_id,
                ip_address,
                user_agent[:512],
                country,
                city,
                success,
            ),
        )
        conn.commit()


async def check_excessive_usage(user_id: str) -> dict[str, Any] | None:
    try:
        chat_count = await asyncio.to_thread(_usage_last_hour_sync, user_id, "chat_messages")
        if chat_count <= EXCESSIVE_USAGE_THRESHOLD:
            return None
        severity = "critical" if chat_count > EXCESSIVE_USAGE_THRESHOLD * 2 else "high"
        return {
            "risk_type": "excessive_usage",
            "severity": severity,
            "details": {
                "metric": "chat_messages",
                "count_last_hour": chat_count,
                "threshold": EXCESSIVE_USAGE_THRESHOLD,
            },
        }
    except Exception as exc:
        logger.debug("check_excessive_usage failed for %s: %s", user_id, exc)
        return None


async def check_account_sharing(user_id: str) -> dict[str, Any] | None:
    try:
        ip_count = await asyncio.to_thread(_distinct_ips_last_day_sync, user_id)
        if ip_count <= ACCOUNT_SHARING_IP_THRESHOLD:
            return None
        severity = "critical" if ip_count > ACCOUNT_SHARING_IP_THRESHOLD + 2 else "medium"
        return {
            "risk_type": "account_sharing",
            "severity": severity,
            "details": {
                "distinct_ips_24h": ip_count,
                "threshold": ACCOUNT_SHARING_IP_THRESHOLD,
            },
        }
    except Exception as exc:
        logger.debug("check_account_sharing failed for %s: %s", user_id, exc)
        return None


async def check_trial_abuse(user_id: str) -> dict[str, Any] | None:
    try:
        limits = await asyncio.to_thread(_get_user_plan_limits_sync, user_id)
        plan_name = str(limits.get("plan_name") or "free")
        if plan_name != "free":
            return None

        period_key = _current_period_key()
        metrics = ["chat_messages", "voice_minutes", "quiz_generations", "kb_uploads"]
        exceeded: list[dict[str, Any]] = []
        for metric in metrics:
            limit = int(limits.get(metric, 0))
            if limit <= 0:
                continue
            used = await asyncio.to_thread(_get_usage_sync, user_id, metric, period_key)
            if used >= limit * TRIAL_ABUSE_RATIO:
                exceeded.append(
                    {
                        "metric": metric,
                        "used": used,
                        "limit": limit,
                        "ratio": round(used / limit, 2),
                    }
                )
        if len(exceeded) < TRIAL_ABUSE_MIN_METRICS:
            return None
        max_ratio = max(item["ratio"] for item in exceeded)
        severity = "high" if max_ratio >= 2.0 else "medium"
        return {
            "risk_type": "trial_abuse",
            "severity": severity,
            "details": {
                "plan_name": plan_name,
                "period_key": period_key,
                "exceeded_metrics": exceeded,
            },
        }
    except Exception as exc:
        logger.debug("check_trial_abuse failed for %s: %s", user_id, exc)
        return None


async def _maybe_create_flag(user_id: str, finding: dict[str, Any]) -> dict[str, Any] | None:
    risk_type = str(finding["risk_type"])
    has_open = await asyncio.to_thread(_has_open_flag_sync, user_id, risk_type)
    if has_open:
        return None
    return await asyncio.to_thread(
        _create_flag_sync,
        user_id=user_id,
        risk_type=risk_type,
        severity=str(finding["severity"]),
        details=dict(finding.get("details") or {}),
    )


async def run_risk_scan(user_id: str | None = None) -> list[dict[str, Any]]:
    """Run all checks for one user or all non-admin users. Returns newly created flags."""
    created: list[dict[str, Any]] = []
    try:
        if user_id:
            user_ids = [user_id]
        else:
            users = list_user_info()
            user_ids = [
                str(user["id"])
                for user in users
                if user.get("id")
                and user.get("role") != "admin"
                and not user.get("disabled")
                and not user.get("banned")
            ]

        checks = (check_excessive_usage, check_account_sharing, check_trial_abuse)
        for uid in user_ids:
            for check in checks:
                finding = await check(uid)
                if not finding:
                    continue
                flag = await _maybe_create_flag(uid, finding)
                if flag:
                    created.append(flag)
    except Exception as exc:
        logger.debug("run_risk_scan failed: %s", exc)
    return created


def _get_risk_summary_sync() -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT severity, status, COUNT(*) AS count
            FROM user_risk_flags
            GROUP BY severity, status
            ORDER BY severity ASC, status ASC
            """
        )
        grouped = [dict(row) for row in cur.fetchall()]
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM user_risk_flags
            WHERE status = 'open'
            """
        )
        unreviewed = int(cur.fetchone()["count"])
        cur.execute(
            """
            SELECT severity, COUNT(*) AS count
            FROM user_risk_flags
            WHERE status = 'open'
            GROUP BY severity
            """
        )
        open_by_severity = {str(row["severity"]): int(row["count"]) for row in cur.fetchall()}
    return {
        "unreviewed": unreviewed,
        "open_by_severity": {
            "critical": open_by_severity.get("critical", 0),
            "high": open_by_severity.get("high", 0),
            "medium": open_by_severity.get("medium", 0),
            "low": open_by_severity.get("low", 0),
        },
        "by_severity_status": [
            {
                "severity": str(row["severity"]),
                "status": str(row["status"]),
                "count": int(row["count"]),
            }
            for row in grouped
        ],
    }


def _list_risk_flags_sync(
    *,
    severity: str | None,
    risk_type: str | None,
    status: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if severity:
        clauses.append("f.severity = %s")
        params.append(severity)
    if risk_type:
        clauses.append("f.risk_type = %s")
        params.append(risk_type)
    if status:
        clauses.append("f.status = %s")
        params.append(status)
    params.append(limit)
    where_sql = " AND ".join(clauses)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                f.id, f.user_id, f.risk_type, f.severity, f.details, f.status,
                f.reviewed_by, f.review_note, f.created_at, f.updated_at,
                au.username
            FROM user_risk_flags f
            LEFT JOIN auth_users au ON au.id = f.user_id
            WHERE {where_sql}
            ORDER BY f.created_at DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        item = _row_to_flag(dict(row))
        item["username"] = str(row.get("username") or "")
        results.append(item)
    return results


def _review_flag_sync(
    *,
    flag_id: str,
    status: str,
    reviewed_by: str,
    review_note: str,
) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE user_risk_flags
            SET status = %s,
                reviewed_by = %s,
                review_note = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING id, user_id, risk_type, severity, details, status, reviewed_by, review_note, created_at, updated_at
            """,
            (status, reviewed_by, review_note, flag_id),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        conn.commit()
    return _row_to_flag(dict(row))


async def get_risk_summary() -> dict[str, Any]:
    try:
        return await asyncio.to_thread(_get_risk_summary_sync)
    except Exception as exc:
        logger.debug("get_risk_summary failed: %s", exc)
        return {
            "unreviewed": 0,
            "open_by_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
            "by_severity_status": [],
        }


async def list_risk_flags(
    *,
    severity: str | None = None,
    risk_type: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(
            _list_risk_flags_sync,
            severity=severity,
            risk_type=risk_type,
            status=status,
            limit=max(1, min(limit, 500)),
        )
    except Exception as exc:
        logger.debug("list_risk_flags failed: %s", exc)
        return []


async def review_risk_flag(
    *,
    flag_id: str,
    status: str,
    reviewed_by: str,
    review_note: str = "",
) -> dict[str, Any] | None:
    try:
        return await asyncio.to_thread(
            _review_flag_sync,
            flag_id=flag_id,
            status=status,
            reviewed_by=reviewed_by,
            review_note=review_note,
        )
    except Exception as exc:
        logger.debug("review_risk_flag failed: %s", exc)
        return None
