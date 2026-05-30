"""Razorpay subscription billing backed by Postgres."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import razorpay

from aimtutor.services.db import connect
from aimtutor.services.quota import assign_plan_to_user, get_full_usage_summary, get_plan, list_plans

logger = logging.getLogger(__name__)

PAYMENT_STATUSES = frozenset({"created", "paid", "failed", "refunded"})
SUBSCRIPTION_STATUSES = frozenset({"active", "cancelled", "past_due", "inactive"})


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _razorpay_client() -> razorpay.Client:
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not key_secret:
        raise RuntimeError("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.")
    return razorpay.Client(auth=(key_id, key_secret))


def razorpay_key_id() -> str:
    return os.getenv("RAZORPAY_KEY_ID", "").strip()


def _webhook_secret() -> str:
    return os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()


def _payment_row_to_dict(row: dict[str, Any], plan: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "plan_id": str(row["plan_id"]),
        "razorpay_order_id": str(row["razorpay_order_id"]),
        "razorpay_payment_id": str(row["razorpay_payment_id"]) if row.get("razorpay_payment_id") else None,
        "amount": int(row["amount"]),
        "currency": str(row.get("currency") or "INR"),
        "status": str(row.get("status") or "created"),
        "period_months": int(row.get("period_months") or 1),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    if plan:
        payload["plan_name"] = plan.get("name")
        payload["plan_display"] = plan.get("display_name")
    return payload


def _subscription_row_to_dict(row: dict[str, Any], plan: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "id": str(row["id"]),
        "user_id": str(row["user_id"]),
        "plan_id": str(row["plan_id"]),
        "status": str(row.get("status") or "active"),
        "current_period_start": _iso_timestamp(row.get("current_period_start")),
        "current_period_end": _iso_timestamp(row.get("current_period_end")),
        "cancel_at_period_end": bool(row.get("cancel_at_period_end", False)),
        "created_at": _iso_timestamp(row.get("created_at")),
        "updated_at": _iso_timestamp(row.get("updated_at")),
    }
    if plan:
        payload["plan_name"] = plan.get("name")
        payload["plan_display"] = plan.get("display_name")
    return payload


def _plan_amount_paise(plan: dict[str, Any], period_months: int) -> int:
    if period_months >= 12:
        amount_rupees = float(plan.get("price_yearly") or 0)
    else:
        amount_rupees = float(plan.get("price_monthly") or 0)
    paise = int(round(amount_rupees * 100))
    if paise <= 0:
        raise ValueError("Selected plan has no payable price configured")
    return paise


def _get_payment_by_order_id_sync(order_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM payments WHERE razorpay_order_id = %s", (order_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def _get_payment_by_id_sync(payment_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM payments WHERE id = %s", (payment_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def _list_user_payments_sync(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.*, pl.name AS plan_name, pl.display_name AS plan_display
            FROM payments p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            WHERE p.user_id = %s
            ORDER BY p.created_at DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        rows = cur.fetchall()
    return [
        _payment_row_to_dict(
            dict(row),
            {"name": row.get("plan_name"), "display_name": row.get("plan_display")},
        )
        for row in rows
    ]


def _get_user_subscription_sync(user_id: str) -> dict[str, Any] | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.*, pl.name AS plan_name, pl.display_name AS plan_display
            FROM subscriptions s
            LEFT JOIN plans pl ON pl.id = s.plan_id
            WHERE s.user_id = %s
            """,
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    record = dict(row)
    plan = {"name": record.pop("plan_name", None), "display_name": record.pop("plan_display", None)}
    return _subscription_row_to_dict(record, plan)


async def _activate_subscription(user_id: str, plan_id: str, period_months: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    period_end = now + timedelta(days=30 * period_months)

    def _write() -> dict[str, Any]:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO subscriptions (
                    id, user_id, plan_id, status,
                    current_period_start, current_period_end,
                    cancel_at_period_end, created_at, updated_at
                )
                VALUES (
                    %s, %s, %s, 'active',
                    %s, %s,
                    FALSE, now(), now()
                )
                ON CONFLICT (user_id) DO UPDATE SET
                    plan_id = EXCLUDED.plan_id,
                    status = 'active',
                    current_period_start = EXCLUDED.current_period_start,
                    current_period_end = EXCLUDED.current_period_end,
                    cancel_at_period_end = FALSE,
                    updated_at = now()
                RETURNING *
                """,
                (f"sub_{uuid4().hex}", user_id, plan_id, now, period_end),
            )
            row = dict(cur.fetchone())
            conn.commit()
        return row

    row = await asyncio.to_thread(_write)
    await assign_plan_to_user(user_id, plan_id, period_end)
    plan = await get_plan(plan_id)
    return _subscription_row_to_dict(row, plan)


async def create_order(user_id: str, plan_id: str, period_months: int) -> dict[str, Any]:
    if period_months not in (1, 12):
        raise ValueError("period_months must be 1 or 12")
    plan = await get_plan(plan_id)
    if not plan or not plan.get("is_active"):
        raise ValueError("Plan not found or inactive")
    amount = _plan_amount_paise(plan, period_months)
    payment_id = f"pay_{uuid4().hex}"

    def _create_razorpay_order() -> str:
        client = _razorpay_client()
        order = client.order.create(
            {
                "amount": amount,
                "currency": "INR",
                "receipt": payment_id,
                "notes": {
                    "user_id": user_id,
                    "plan_id": plan_id,
                    "period_months": str(period_months),
                },
            }
        )
        return str(order["id"])

    order_id = await asyncio.to_thread(_create_razorpay_order)

    def _insert_payment() -> None:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO payments (
                    id, user_id, plan_id, razorpay_order_id,
                    amount, currency, status, period_months,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, 'INR', 'created', %s, now(), now())
                """,
                (payment_id, user_id, plan_id, order_id, amount, period_months),
            )
            conn.commit()

    await asyncio.to_thread(_insert_payment)
    return {
        "payment_id": payment_id,
        "order_id": order_id,
        "amount": amount,
        "currency": "INR",
        "key_id": razorpay_key_id(),
        "period_months": period_months,
        "plan": {
            "id": plan["id"],
            "name": plan["name"],
            "display_name": plan["display_name"],
        },
    }


def verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not secret:
        return False
    body = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    secret = _webhook_secret()
    if not secret:
        logger.warning("RAZORPAY_WEBHOOK_SECRET is not configured")
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def verify_and_capture_payment(
    user_id: str,
    order_id: str,
    payment_id: str,
    signature: str,
) -> dict[str, Any]:
    if not verify_signature(order_id, payment_id, signature):
        raise ValueError("Invalid payment signature")

    def _load_payment() -> dict[str, Any] | None:
        return _get_payment_by_order_id_sync(order_id)

    payment = await asyncio.to_thread(_load_payment)
    if payment is None:
        raise ValueError("Payment record not found")
    if str(payment["user_id"]) != user_id:
        raise PermissionError("Payment does not belong to this user")
    if str(payment.get("status")) == "paid":
        subscription = await asyncio.to_thread(_get_user_subscription_sync, user_id)
        return {
            "ok": True,
            "already_processed": True,
            "payment": _payment_row_to_dict(payment),
            "subscription": subscription,
        }

    def _mark_paid() -> dict[str, Any]:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE payments
                SET status = 'paid',
                    razorpay_payment_id = %s,
                    updated_at = now()
                WHERE razorpay_order_id = %s AND status = 'created'
                RETURNING *
                """,
                (payment_id, order_id),
            )
            row = cur.fetchone()
            conn.commit()
        if row is None:
            updated = _get_payment_by_order_id_sync(order_id)
            if updated and str(updated.get("status")) == "paid":
                return dict(updated)
            raise RuntimeError("Failed to mark payment as paid")
        return dict(row)

    paid_row = await asyncio.to_thread(_mark_paid)
    subscription = await _activate_subscription(
        user_id,
        str(paid_row["plan_id"]),
        int(paid_row.get("period_months") or 1),
    )
    plan = await get_plan(str(paid_row["plan_id"]))
    return {
        "ok": True,
        "payment": _payment_row_to_dict(paid_row, plan),
        "subscription": subscription,
    }


async def get_billing_me(user_id: str) -> dict[str, Any]:
    subscription, payments, usage, plans = await asyncio.gather(
        asyncio.to_thread(_get_user_subscription_sync, user_id),
        asyncio.to_thread(_list_user_payments_sync, user_id),
        get_full_usage_summary(user_id),
        list_plans(),
    )
    active_plans = [plan for plan in plans if plan.get("is_active")]
    return {
        "subscription": subscription,
        "usage": usage,
        "payments": payments,
        "plans": active_plans,
        "razorpay_configured": bool(razorpay_key_id()),
    }


def _admin_summary_sync() -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS total_revenue_paise,
                COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END), 0) AS refunded_paise,
                COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_count
            FROM payments
            """
        )
        totals = dict(cur.fetchone())
        cur.execute("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'")
        active_subs = int(cur.fetchone()["count"])
        cur.execute(
            """
            SELECT DATE(created_at) AS day,
                   COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS revenue_paise
            FROM payments
            WHERE created_at >= now() - interval '30 days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
            """
        )
        revenue_by_day = [
            {"day": _iso_timestamp(row["day"]), "revenue_paise": int(row["revenue_paise"])}
            for row in cur.fetchall()
        ]
        cur.execute(
            """
            SELECT pl.display_name AS label,
                   COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) AS revenue_paise
            FROM payments p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            GROUP BY pl.display_name
            ORDER BY revenue_paise DESC
            """
        )
        revenue_by_plan = [
            {"label": str(row["label"] or "Unknown"), "revenue_paise": int(row["revenue_paise"])}
            for row in cur.fetchall()
        ]
    return {
        "total_revenue_paise": int(totals["total_revenue_paise"]),
        "paid_count": int(totals["paid_count"]),
        "refunded_paise": int(totals["refunded_paise"]),
        "refunded_count": int(totals["refunded_count"]),
        "active_subscriptions": active_subs,
        "revenue_by_day": revenue_by_day,
        "revenue_by_plan": revenue_by_plan,
    }


def _list_admin_payments_sync(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.*, pl.name AS plan_name, pl.display_name AS plan_display,
                   au.username
            FROM payments p
            LEFT JOIN plans pl ON pl.id = p.plan_id
            LEFT JOIN auth_users au ON au.id = p.user_id
            ORDER BY p.created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
        rows = cur.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        record = dict(row)
        item = _payment_row_to_dict(
            record,
            {"name": record.get("plan_name"), "display_name": record.get("plan_display")},
        )
        item["username"] = str(record.get("username") or "")
        results.append(item)
    return results


async def list_admin_payments(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    summary, payments = await asyncio.gather(
        asyncio.to_thread(_admin_summary_sync),
        asyncio.to_thread(_list_admin_payments_sync, limit, offset),
    )
    return {"summary": summary, "payments": payments}


async def refund_payment(payment_id: str, amount_paise: int | None = None) -> dict[str, Any]:
    payment = await asyncio.to_thread(_get_payment_by_id_sync, payment_id)
    if payment is None:
        raise ValueError("Payment not found")
    if str(payment.get("status")) != "paid":
        raise ValueError("Only paid payments can be refunded")
    razorpay_payment_id = str(payment.get("razorpay_payment_id") or "")
    if not razorpay_payment_id:
        raise ValueError("Payment has no Razorpay payment id")

    refund_amount = amount_paise or int(payment["amount"])

    def _call_refund() -> dict[str, Any]:
        client = _razorpay_client()
        return client.payment.refund(razorpay_payment_id, {"amount": refund_amount})

    refund_result = await asyncio.to_thread(_call_refund)

    def _mark_refunded() -> dict[str, Any]:
        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE payments
                SET status = 'refunded', updated_at = now()
                WHERE id = %s
                RETURNING *
                """,
                (payment_id,),
            )
            row = dict(cur.fetchone())
            cur.execute(
                """
                UPDATE subscriptions
                SET status = 'cancelled', cancel_at_period_end = TRUE, updated_at = now()
                WHERE user_id = %s
                """,
                (str(payment["user_id"]),),
            )
            conn.commit()
        return row

    updated = await asyncio.to_thread(_mark_refunded)
    plan = await get_plan(str(updated["plan_id"]))
    return {
        "ok": True,
        "refund": refund_result,
        "payment": _payment_row_to_dict(updated, plan),
    }


async def handle_webhook(body: bytes, signature: str) -> dict[str, Any]:
    if not verify_webhook_signature(body, signature):
        raise PermissionError("Invalid webhook signature")
    payload = json.loads(body.decode("utf-8"))
    event = str(payload.get("event") or "")
    entity = payload.get("payload", {})
    payment_entity = (
        entity.get("payment", {}).get("entity")
        if isinstance(entity.get("payment"), dict)
        else None
    )
    if event == "payment.captured" and payment_entity:
        order_id = str(payment_entity.get("order_id") or "")
        payment_id = str(payment_entity.get("id") or "")
        notes = payment_entity.get("notes") or {}
        user_id = str(notes.get("user_id") or "")
        if order_id and payment_id and user_id:
            existing = await asyncio.to_thread(_get_payment_by_order_id_sync, order_id)
            if existing and str(existing.get("status")) != "paid":
                await _activate_subscription(
                    user_id,
                    str(existing["plan_id"]),
                    int(existing.get("period_months") or 1),
                )

                def _mark_paid_webhook() -> None:
                    with connect() as conn, conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE payments
                            SET status = 'paid',
                                razorpay_payment_id = %s,
                                updated_at = now()
                            WHERE razorpay_order_id = %s
                            """,
                            (payment_id, order_id),
                        )
                        conn.commit()

                await asyncio.to_thread(_mark_paid_webhook)
    elif event == "payment.failed" and payment_entity:
        order_id = str(payment_entity.get("order_id") or "")

        def _mark_failed() -> None:
            with connect() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE payments SET status = 'failed', updated_at = now()
                    WHERE razorpay_order_id = %s AND status = 'created'
                    """,
                    (order_id,),
                )
                conn.commit()

        if order_id:
            await asyncio.to_thread(_mark_failed)
    return {"ok": True, "event": event}
