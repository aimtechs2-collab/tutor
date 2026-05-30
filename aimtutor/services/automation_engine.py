"""IF-THEN automation rule evaluation and execution."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from aimtutor.multi_user.identity import list_user_info, suspend_user
from aimtutor.services.db import connect
from aimtutor.services.quota import _get_user_plan_limits_sync, _get_usage_sync, record_usage

logger = logging.getLogger(__name__)

TRIGGERS = frozenset(
    {
        "user.inactive_days",
        "user.trial_ending_days",
        "user.quota_percent",
        "user.failed_payment",
        "schedule.daily",
    }
)

ACTIONS = frozenset(
    {
        "send_in_app_notification",
        "suspend_user",
        "add_quota_bonus",
        "create_risk_flag",
        "notify_admin",
        "log_event",
    }
)


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if value is not None else {}


def _row_to_rule(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "description": str(row.get("description") or ""),
        "enabled": bool(row.get("enabled", True)),
        "trigger": _parse_json(row.get("trigger")),
        "actions": _parse_json(row.get("actions")) or [],
        "last_run_at": _iso_timestamp(row["last_run_at"]) if row.get("last_run_at") else None,
        "run_count": int(row.get("run_count") or 0),
        "created_by": str(row.get("created_by") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }


def _row_to_log(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "rule_id": str(row["rule_id"]),
        "user_id": str(row["user_id"]) if row.get("user_id") else None,
        "triggered": bool(row.get("triggered", False)),
        "actions": _parse_json(row.get("actions")) or [],
        "success": bool(row.get("success", False)),
        "error": str(row.get("error") or ""),
        "created_at": _iso_timestamp(row.get("created_at")),
        "rule_name": str(row.get("rule_name") or ""),
        "username": str(row.get("username") or ""),
    }


def _current_period_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _last_activity_sync(user_id: str) -> datetime | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(created_at) AS last_seen
            FROM (
                SELECT created_at FROM user_login_events WHERE user_id = %s
                UNION ALL
                SELECT created_at FROM usage_records WHERE user_id = %s
            ) activity
            """,
            (user_id, user_id),
        )
        row = cur.fetchone()
    value = row["last_seen"] if row else None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    return None


def _trial_end_days_sync(user_id: str) -> float | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.current_period_end, p.name
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.user_id = %s AND s.status = 'active'
            LIMIT 1
            """,
            (user_id,),
        )
        sub = cur.fetchone()
        if sub:
            end = sub["current_period_end"]
            if isinstance(end, datetime):
                return (end.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 86400.0
        cur.execute(
            """
            SELECT up.expires_at, p.name
            FROM user_plans up
            JOIN plans p ON p.id = up.plan_id
            WHERE up.user_id = %s AND up.status = 'active'
            ORDER BY up.started_at DESC
            LIMIT 1
            """,
            (user_id,),
        )
        plan = cur.fetchone()
    if not plan or not plan.get("expires_at"):
        return None
    expires = plan["expires_at"]
    if not isinstance(expires, datetime):
        return None
    return (expires.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 86400.0


def _recent_failed_payment_sync(user_id: str, within_hours: int) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM payments
            WHERE user_id = %s
              AND status = 'failed'
              AND created_at >= now() - make_interval(hours => %s)
            LIMIT 1
            """,
            (user_id, within_hours),
        )
        return cur.fetchone() is not None


def _write_user_notification_sync(user_id: str, title: str, message: str) -> None:
    try:
        from aimtutor.services.notifications import create_notification_sync

        create_notification_sync(user_id, title=title, body=message, category="automation")
        return
    except Exception:
        logger.exception("Failed to persist in-app notification, falling back to JSONL")

    from aimtutor.multi_user.paths import SYSTEM_ROOT, ensure_system_dirs

    ensure_system_dirs()
    notifications_dir = SYSTEM_ROOT / "notifications"
    notifications_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "time": datetime.now(timezone.utc).isoformat(),
        "title": title,
        "message": message,
    }
    path = notifications_dir / f"{user_id}.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def list_rules_sync() -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, description, enabled, trigger, actions,
                   last_run_at, run_count, created_by, created_at, updated_at
            FROM automation_rules
            ORDER BY created_at DESC
            """
        )
        rows = cur.fetchall()
    return [_row_to_rule(dict(row)) for row in rows]


def get_rule_sync(rule_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, description, enabled, trigger, actions,
                   last_run_at, run_count, created_by, created_at, updated_at
            FROM automation_rules
            WHERE id = %s
            """,
            (rule_id,),
        )
        row = cur.fetchone()
    return _row_to_rule(dict(row)) if row else None


def create_rule_sync(
    *,
    name: str,
    description: str,
    enabled: bool,
    trigger: dict[str, Any],
    actions: list[dict[str, Any]],
    created_by: str,
) -> dict[str, Any]:
    rule_id = f"rule_{uuid4().hex}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO automation_rules (
                id, name, description, enabled, trigger, actions,
                run_count, created_by, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, 0, %s, now(), now())
            RETURNING id, name, description, enabled, trigger, actions,
                      last_run_at, run_count, created_by, created_at, updated_at
            """,
            (
                rule_id,
                name,
                description,
                enabled,
                json.dumps(trigger),
                json.dumps(actions),
                created_by,
            ),
        )
        row = dict(cur.fetchone())
        conn.commit()
    return _row_to_rule(row)


def update_rule_sync(
    rule_id: str,
    *,
    name: str,
    description: str,
    enabled: bool,
    trigger: dict[str, Any],
    actions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE automation_rules
            SET name = %s,
                description = %s,
                enabled = %s,
                trigger = %s::jsonb,
                actions = %s::jsonb,
                updated_at = now()
            WHERE id = %s
            RETURNING id, name, description, enabled, trigger, actions,
                      last_run_at, run_count, created_by, created_at, updated_at
            """,
            (name, description, enabled, json.dumps(trigger), json.dumps(actions), rule_id),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        conn.commit()
    return _row_to_rule(dict(row))


def delete_rule_sync(rule_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM automation_rules WHERE id = %s", (rule_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def toggle_rule_sync(rule_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE automation_rules
            SET enabled = NOT enabled, updated_at = now()
            WHERE id = %s
            RETURNING id, name, description, enabled, trigger, actions,
                      last_run_at, run_count, created_by, created_at, updated_at
            """,
            (rule_id,),
        )
        row = cur.fetchone()
        if not row:
            conn.commit()
            return None
        conn.commit()
    return _row_to_rule(dict(row))


def _touch_rule_run_sync(rule_id: str) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE automation_rules
            SET last_run_at = now(), run_count = run_count + 1, updated_at = now()
            WHERE id = %s
            """,
            (rule_id,),
        )
        conn.commit()


def _insert_log_sync(
    *,
    rule_id: str,
    user_id: str | None,
    triggered: bool,
    actions: list[dict[str, Any]],
    success: bool,
    error: str = "",
) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO automation_logs (
                id, rule_id, user_id, triggered, actions, success, error, created_at
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, now())
            """,
            (
                f"alog_{uuid4().hex}",
                rule_id,
                user_id,
                triggered,
                json.dumps(actions),
                success,
                error,
            ),
        )
        conn.commit()


def list_logs_sync(*, rule_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: list[Any] = []
    if rule_id:
        clauses.append("l.rule_id = %s")
        params.append(rule_id)
    params.append(limit)
    where_sql = " AND ".join(clauses)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT l.*, r.name AS rule_name, au.username
            FROM automation_logs l
            LEFT JOIN automation_rules r ON r.id = l.rule_id
            LEFT JOIN auth_users au ON au.id = l.user_id
            WHERE {where_sql}
            ORDER BY l.created_at DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [_row_to_log(dict(row)) for row in rows]


async def evaluate_trigger(trigger: dict[str, Any], user_info: dict[str, Any]) -> bool:
    try:
        trigger_type = str(trigger.get("type") or "")
        if trigger_type not in TRIGGERS:
            return False

        user_id = str(user_info.get("id") or user_info.get("user_id") or "")

        if trigger_type == "user.inactive_days":
            if not user_id:
                return False
            days = int(trigger.get("days") or 14)
            last_seen = await asyncio.to_thread(_last_activity_sync, user_id)
            if last_seen is None:
                created_at = user_info.get("created_at")
                if created_at:
                    try:
                        last_seen = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                    except ValueError:
                        return False
                else:
                    return False
            inactive_days = (datetime.now(timezone.utc) - last_seen).total_seconds() / 86400.0
            return inactive_days >= days

        if trigger_type == "user.trial_ending_days":
            if not user_id:
                return False
            days_threshold = float(trigger.get("days") or 3)
            days_left = await asyncio.to_thread(_trial_end_days_sync, user_id)
            if days_left is None:
                return False
            return 0 <= days_left <= days_threshold

        if trigger_type == "user.quota_percent":
            if not user_id:
                return False
            metric = str(trigger.get("metric") or "chat_messages")
            threshold = float(trigger.get("percent") or 90)
            limits = await asyncio.to_thread(_get_user_plan_limits_sync, user_id)
            limit = int(limits.get(metric, 0))
            if limit <= 0:
                return False
            used = await asyncio.to_thread(_get_usage_sync, user_id, metric, _current_period_key())
            percent = (used / limit) * 100.0
            return percent >= threshold

        if trigger_type == "user.failed_payment":
            if not user_id:
                return False
            within_hours = int(trigger.get("within_hours") or 24)
            return await asyncio.to_thread(_recent_failed_payment_sync, user_id, within_hours)

        if trigger_type == "schedule.daily":
            last_run_at = trigger.get("_last_run_at")
            if not last_run_at:
                return True
            try:
                last_run = datetime.fromisoformat(str(last_run_at).replace("Z", "+00:00"))
            except ValueError:
                return True
            return datetime.now(timezone.utc) - last_run >= timedelta(hours=23)

        return False
    except Exception as exc:
        logger.debug("evaluate_trigger failed: %s", exc)
        return False


async def execute_actions(rule_id: str, actions: list[dict[str, Any]], user_info: dict[str, Any]) -> bool:
    user_id = str(user_info.get("id") or user_info.get("user_id") or "")
    username = str(user_info.get("username") or "")
    executed: list[dict[str, Any]] = []
    try:
        for action in actions:
            action_type = str(action.get("type") or "")
            if action_type not in ACTIONS:
                executed.append({"type": action_type, "ok": False, "error": "unknown action"})
                continue

            if action_type == "send_in_app_notification":
                if not user_id:
                    executed.append({"type": action_type, "ok": False, "error": "missing user_id"})
                    continue
                title = str(action.get("title") or "AIMTutor notice")
                message = str(action.get("message") or "").format(username=username, user_id=user_id)
                await asyncio.to_thread(_write_user_notification_sync, user_id, title, message)
                executed.append({"type": action_type, "ok": True})

            elif action_type == "suspend_user":
                if not user_id:
                    executed.append({"type": action_type, "ok": False, "error": "missing user_id"})
                    continue
                reason = str(action.get("reason") or "Automated suspension").format(
                    username=username, user_id=user_id
                )
                ok = await asyncio.to_thread(suspend_user, user_id, reason)
                executed.append({"type": action_type, "ok": ok})

            elif action_type == "add_quota_bonus":
                if not user_id:
                    executed.append({"type": action_type, "ok": False, "error": "missing user_id"})
                    continue
                metric = str(action.get("metric") or "chat_messages")
                amount = float(action.get("amount") or 0)
                if amount <= 0:
                    executed.append({"type": action_type, "ok": False, "error": "invalid amount"})
                    continue
                await record_usage(user_id, metric, -amount)
                executed.append({"type": action_type, "ok": True, "metric": metric, "amount": amount})

            elif action_type == "create_risk_flag":
                if not user_id:
                    executed.append({"type": action_type, "ok": False, "error": "missing user_id"})
                    continue
                from aimtutor.services.risk_agent import _create_flag_sync, _has_open_flag_sync

                risk_type = str(action.get("risk_type") or "automation")
                if await asyncio.to_thread(_has_open_flag_sync, user_id, risk_type):
                    executed.append({"type": action_type, "ok": True, "skipped": "open flag exists"})
                    continue
                flag = await asyncio.to_thread(
                    _create_flag_sync,
                    user_id=user_id,
                    risk_type=risk_type,
                    severity=str(action.get("severity") or "medium"),
                    details={
                        "source": "automation",
                        "rule_id": rule_id,
                        "message": str(action.get("message") or ""),
                    },
                )
                executed.append({"type": action_type, "ok": True, "flag_id": flag["id"]})

            elif action_type == "notify_admin":
                message = str(action.get("message") or "Automation event").format(
                    username=username, user_id=user_id, rule_id=rule_id
                )
                logger.info("automation.notify_admin rule=%s user=%s: %s", rule_id, user_id or "-", message)
                executed.append({"type": action_type, "ok": True, "message": message})

            elif action_type == "log_event":
                message = str(action.get("message") or "Automation log").format(
                    username=username, user_id=user_id, rule_id=rule_id
                )
                logger.info("automation.log_event rule=%s user=%s: %s", rule_id, user_id or "-", message)
                executed.append({"type": action_type, "ok": True, "message": message})

        success = all(item.get("ok") for item in executed) if executed else False
        await asyncio.to_thread(
            _insert_log_sync,
            rule_id=rule_id,
            user_id=user_id or None,
            triggered=True,
            actions=executed,
            success=success,
        )
        return success
    except Exception as exc:
        logger.debug("execute_actions failed rule=%s: %s", rule_id, exc)
        await asyncio.to_thread(
            _insert_log_sync,
            rule_id=rule_id,
            user_id=user_id or None,
            triggered=True,
            actions=executed,
            success=False,
            error=str(exc),
        )
        return False


async def _run_rule(rule: dict[str, Any]) -> int:
    actions_taken = 0
    trigger = dict(rule.get("trigger") or {})
    actions = list(rule.get("actions") or [])
    rule_id = str(rule["id"])
    trigger_type = str(trigger.get("type") or "")

    if trigger_type == "schedule.daily":
        user_info = {"id": "", "username": "system"}
        trigger_with_meta = {**trigger, "_last_run_at": rule.get("last_run_at")}
        if await evaluate_trigger(trigger_with_meta, user_info):
            if await execute_actions(rule_id, actions, user_info):
                actions_taken += len(actions)
        await asyncio.to_thread(_touch_rule_run_sync, rule_id)
        return actions_taken

    users = list_user_info()
    candidates = [
        user
        for user in users
        if user.get("id")
        and user.get("role") != "admin"
        and not user.get("disabled")
        and not user.get("banned")
    ]

    for user in candidates:
        user_info = dict(user)
        if not await evaluate_trigger(trigger, user_info):
            continue
        if await execute_actions(rule_id, actions, user_info):
            actions_taken += len(actions)

    await asyncio.to_thread(_touch_rule_run_sync, rule_id)
    return actions_taken


async def run_automation_cycle(rule_id: str | None = None) -> int:
    """Evaluate enabled rules and execute matching actions. Returns action count."""
    total = 0
    try:
        if rule_id:
            rule = await asyncio.to_thread(get_rule_sync, rule_id)
            rules = [rule] if rule and rule.get("enabled") else []
        else:
            rules = [rule for rule in await asyncio.to_thread(list_rules_sync) if rule.get("enabled")]

        for rule in rules:
            total += await _run_rule(rule)
    except Exception as exc:
        logger.debug("run_automation_cycle failed: %s", exc)
    return total


async def list_rules() -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(list_rules_sync)
    except Exception as exc:
        logger.debug("list_rules failed: %s", exc)
        return []


async def list_logs(*, rule_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(list_logs_sync, rule_id=rule_id, limit=limit)
    except Exception as exc:
        logger.debug("list_logs failed: %s", exc)
        return []
