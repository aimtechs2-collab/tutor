from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from aimtutor.services.db import connect

# Default limits for seed data
DEFAULT_PLAN_LIMITS = {
    "free": {"chat_messages": 100, "voice_minutes": 10, "quiz_generations": 5, "kb_uploads": 3},
    "basic": {"chat_messages": 500, "voice_minutes": 30, "quiz_generations": 20, "kb_uploads": 10},
    "pro": {"chat_messages": 2000, "voice_minutes": 120, "quiz_generations": 100, "kb_uploads": 50},
    "premium": {"chat_messages": -1, "voice_minutes": -1, "quiz_generations": -1, "kb_uploads": -1},
}


def _free_limits() -> dict[str, int | str]:
    return {**DEFAULT_PLAN_LIMITS["free"], "plan_name": "free", "plan_display": "Free"}


def _get_user_plan_limits_sync(user_id: str) -> dict[str, int | str]:
    """Get the active plan limits for a user. Falls back to free plan."""
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    p.name,
                    p.display_name,
                    p.chat_messages,
                    p.voice_minutes,
                    p.quiz_generations,
                    p.kb_uploads
                FROM user_plans up
                JOIN plans p ON p.id = up.plan_id
                WHERE up.user_id = %s AND up.status = 'active'
                ORDER BY up.started_at DESC
                LIMIT 1
                """,
                (user_id,),
            )
            row = cur.fetchone()
        if row:
            return {
                "chat_messages": int(row["chat_messages"]),
                "voice_minutes": int(row["voice_minutes"]),
                "quiz_generations": int(row["quiz_generations"]),
                "kb_uploads": int(row["kb_uploads"]),
                "plan_name": str(row["name"]),
                "plan_display": str(row["display_name"]),
            }
    except Exception:
        pass
    return _free_limits()


def _get_usage_sync(user_id: str, metric: str, period_key: str) -> float:
    """Sum usage for user/metric/period."""
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(SUM(value), 0) AS total
                FROM usage_records
                WHERE user_id = %s AND metric = %s AND period_key = %s
                """,
                (user_id, metric, period_key),
            )
            row = cur.fetchone()
        return float(row["total"] if row else 0)
    except Exception:
        return 0.0


def _record_usage_sync(user_id: str, metric: str, value: float, period_key: str) -> None:
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO usage_records (id, user_id, metric, value, period_key, created_at)
                VALUES (gen_random_uuid()::text, %s, %s, %s, %s, now())
                """,
                (user_id, metric, value, period_key),
            )
            conn.commit()
    except Exception:
        pass


async def get_user_plan_limits(user_id: str) -> dict[str, int | str]:
    return await asyncio.to_thread(_get_user_plan_limits_sync, user_id)


async def get_usage(user_id: str, metric: str, period_key: str) -> float:
    return await asyncio.to_thread(_get_usage_sync, user_id, metric, period_key)


async def check_quota(user_id: str, metric: str) -> tuple[bool, float, int]:
    """Returns (allowed, used, limit). -1 limit means unlimited."""
    period_key = datetime.now(timezone.utc).strftime("%Y-%m")
    limits = await get_user_plan_limits(user_id)
    limit = int(limits.get(metric, 0))
    if limit == -1:
        return True, 0.0, -1
    used = await get_usage(user_id, metric, period_key)
    return used < limit, used, limit


async def record_usage(user_id: str, metric: str, value: float = 1.0) -> None:
    """Append a usage record."""
    period_key = datetime.now(timezone.utc).strftime("%Y-%m")
    await asyncio.to_thread(_record_usage_sync, user_id, metric, value, period_key)


async def get_full_usage_summary(user_id: str) -> dict[str, Any]:
    """All metrics + limits for the current user — for dashboard display."""
    period_key = datetime.now(timezone.utc).strftime("%Y-%m")
    limits = await get_user_plan_limits(user_id)
    metrics = ["chat_messages", "voice_minutes", "quiz_generations", "kb_uploads"]
    usage: dict[str, dict[str, float | int | bool]] = {}
    for metric in metrics:
        used = await get_usage(user_id, metric, period_key)
        limit = int(limits.get(metric, 0))
        usage[metric] = {"used": used, "limit": limit, "unlimited": limit == -1}
    return {
        "plan_name": limits.get("plan_name", "free"),
        "plan_display": limits.get("plan_display", "Free"),
        "usage": usage,
    }


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _plan_row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "display_name": str(row["display_name"]),
        "price_monthly": float(row["price_monthly"]),
        "price_yearly": float(row["price_yearly"]),
        "chat_messages": int(row["chat_messages"]),
        "voice_minutes": int(row["voice_minutes"]),
        "quiz_generations": int(row["quiz_generations"]),
        "kb_uploads": int(row["kb_uploads"]),
        "is_active": bool(row["is_active"]),
        "user_count": int(row.get("user_count") or 0),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }


def _list_plans_sync() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                p.*,
                (
                    SELECT COUNT(*)
                    FROM user_plans up
                    WHERE up.plan_id = p.id AND up.status = 'active'
                ) AS user_count
            FROM plans p
            ORDER BY p.display_name ASC, p.name ASC
            """
        )
        rows = cur.fetchall()
    return [_plan_row_to_dict(dict(row)) for row in rows]


def _get_plan_sync(plan_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                p.*,
                (
                    SELECT COUNT(*)
                    FROM user_plans up
                    WHERE up.plan_id = p.id AND up.status = 'active'
                ) AS user_count
            FROM plans p
            WHERE p.id = %s
            """,
            (plan_id,),
        )
        row = cur.fetchone()
    return _plan_row_to_dict(dict(row)) if row else None


def _create_plan_sync(data: dict[str, Any]) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO plans (
                id, name, display_name, price_monthly, price_yearly,
                chat_messages, voice_minutes, quiz_generations, kb_uploads,
                is_active, created_at, updated_at
            )
            VALUES (
                gen_random_uuid()::text, %s, %s, %s, %s,
                %s, %s, %s, %s,
                TRUE, now(), now()
            )
            RETURNING id
            """,
            (
                data["name"],
                data["display_name"],
                data["price_monthly"],
                data["price_yearly"],
                data["chat_messages"],
                data["voice_minutes"],
                data["quiz_generations"],
                data["kb_uploads"],
            ),
        )
        plan_id = str(cur.fetchone()["id"])
        conn.commit()
    plan = _get_plan_sync(plan_id)
    if plan is None:
        raise RuntimeError("Failed to load created plan")
    return plan


def _update_plan_sync(plan_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE plans
            SET
                name = %s,
                display_name = %s,
                price_monthly = %s,
                price_yearly = %s,
                chat_messages = %s,
                voice_minutes = %s,
                quiz_generations = %s,
                kb_uploads = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING id
            """,
            (
                data["name"],
                data["display_name"],
                data["price_monthly"],
                data["price_yearly"],
                data["chat_messages"],
                data["voice_minutes"],
                data["quiz_generations"],
                data["kb_uploads"],
                plan_id,
            ),
        )
        updated = cur.fetchone() is not None
        conn.commit()
    return _get_plan_sync(plan_id) if updated else None


def _deactivate_plan_sync(plan_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE plans
            SET is_active = FALSE, updated_at = now()
            WHERE id = %s
            RETURNING id
            """,
            (plan_id,),
        )
        updated = cur.fetchone() is not None
        conn.commit()
    return updated


def _assign_plan_sync(
    user_id: str,
    plan_id: str,
    expires_at: datetime | None,
) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM plans WHERE id = %s AND is_active = TRUE", (plan_id,))
        if cur.fetchone() is None:
            raise ValueError("Plan not found or inactive")

        cur.execute(
            """
            UPDATE user_plans
            SET status = 'inactive'
            WHERE user_id = %s AND status = 'active'
            """,
            (user_id,),
        )
        cur.execute(
            """
            INSERT INTO user_plans (id, user_id, plan_id, status, started_at, expires_at)
            VALUES (gen_random_uuid()::text, %s, %s, 'active', now(), %s)
            RETURNING id, user_id, plan_id, status, started_at, expires_at
            """,
            (user_id, plan_id, expires_at),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "plan_id": str(row["plan_id"]),
        "status": str(row["status"]),
        "started_at": _iso_timestamp(row.get("started_at")),
        "expires_at": _iso_timestamp(row.get("expires_at")) if row.get("expires_at") else None,
    }


def _list_plan_users_sync(plan_id: str) -> list[dict[str, Any]]:
    from aimtutor.multi_user.identity import list_user_info

    users_by_id = {item["id"]: item for item in list_user_info() if item.get("id")}
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, user_id, plan_id, status, started_at, expires_at
            FROM user_plans
            WHERE plan_id = %s AND status = 'active'
            ORDER BY started_at DESC
            """,
            (plan_id,),
        )
        rows = cur.fetchall()

    results: list[dict[str, Any]] = []
    for row in rows:
        record = dict(row)
        user_id = str(record["user_id"])
        user = users_by_id.get(user_id, {})
        results.append(
            {
                "id": str(record["id"]),
                "user_id": user_id,
                "plan_id": str(record["plan_id"]),
                "status": str(record["status"]),
                "started_at": _iso_timestamp(record.get("started_at")),
                "expires_at": _iso_timestamp(record.get("expires_at"))
                if record.get("expires_at")
                else None,
                "username": str(user.get("username") or ""),
                "role": str(user.get("role") or "user"),
                "disabled": bool(user.get("disabled", False)),
                "banned": bool(user.get("banned", False)),
            }
        )
    return results


async def list_plans() -> list[dict[str, Any]]:
    return await asyncio.to_thread(_list_plans_sync)


async def get_plan(plan_id: str) -> dict[str, Any] | None:
    return await asyncio.to_thread(_get_plan_sync, plan_id)


async def create_plan(data: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_create_plan_sync, data)


async def update_plan(plan_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    return await asyncio.to_thread(_update_plan_sync, plan_id, data)


async def deactivate_plan(plan_id: str) -> bool:
    return await asyncio.to_thread(_deactivate_plan_sync, plan_id)


async def assign_plan_to_user(
    user_id: str,
    plan_id: str,
    expires_at: datetime | None = None,
) -> dict[str, Any]:
    return await asyncio.to_thread(_assign_plan_sync, user_id, plan_id, expires_at)


async def list_plan_users(plan_id: str) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_list_plan_users_sync, plan_id)


_PLAN_SEEDS: list[dict[str, Any]] = [
    {
        "name": "free",
        "display_name": "Free",
        "price_monthly": 0,
        "price_yearly": 0,
        **DEFAULT_PLAN_LIMITS["free"],
    },
    {
        "name": "basic",
        "display_name": "Basic",
        "price_monthly": 9.99,
        "price_yearly": 99.0,
        **DEFAULT_PLAN_LIMITS["basic"],
    },
    {
        "name": "pro",
        "display_name": "Pro",
        "price_monthly": 29.99,
        "price_yearly": 299.0,
        **DEFAULT_PLAN_LIMITS["pro"],
    },
    {
        "name": "premium",
        "display_name": "Premium",
        "price_monthly": 79.99,
        "price_yearly": 799.0,
        **DEFAULT_PLAN_LIMITS["premium"],
    },
]


def ensure_default_plans_sync() -> None:
    """Insert default SaaS plans when the plans table is empty."""
    try:
        with connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS count FROM plans")
            if int(cur.fetchone()["count"]) > 0:
                return
            for plan in _PLAN_SEEDS:
                cur.execute(
                    """
                    INSERT INTO plans (
                        id, name, display_name, price_monthly, price_yearly,
                        chat_messages, voice_minutes, quiz_generations, kb_uploads,
                        is_active, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid()::text, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        TRUE, now(), now()
                    )
                    ON CONFLICT (name) DO NOTHING
                    """,
                    (
                        plan["name"],
                        plan["display_name"],
                        plan["price_monthly"],
                        plan["price_yearly"],
                        plan["chat_messages"],
                        plan["voice_minutes"],
                        plan["quiz_generations"],
                        plan["kb_uploads"],
                    ),
                )
            conn.commit()
    except Exception:
        pass


async def ensure_default_plans() -> None:
    await asyncio.to_thread(ensure_default_plans_sync)

