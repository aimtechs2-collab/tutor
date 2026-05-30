"""Per-user AI API cost tracking and admin profitability analytics."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from aimtutor.logging.stats.llm_stats import MODEL_PRICING as _BASE_LLM_PRICING
from aimtutor.services.db import connect

logger = logging.getLogger(__name__)

# Per-1K token rates (USD). Extends the shared logging table with additional providers.
MODEL_PRICING: dict[str, dict[str, float]] = {
    **_BASE_LLM_PRICING,
    "gpt-4.1": {"input": 0.002, "output": 0.008},
    "gpt-4.1-mini": {"input": 0.0004, "output": 0.0016},
    "gpt-4.1-nano": {"input": 0.0001, "output": 0.0004},
    "gpt-5": {"input": 0.005, "output": 0.015},
    "gpt-5-mini": {"input": 0.0008, "output": 0.0032},
    "o1": {"input": 0.015, "output": 0.060},
    "o1-mini": {"input": 0.003, "output": 0.012},
    "o3-mini": {"input": 0.004, "output": 0.016},
    "gemini-2.5-pro": {"input": 0.00125, "output": 0.010},
    "gemini-2.5-flash": {"input": 0.0003, "output": 0.0025},
    "gemini-2.0-flash": {"input": 0.0001, "output": 0.0004},
    "gemini-1.5-pro": {"input": 0.00125, "output": 0.005},
    "gemini-1.5-flash": {"input": 0.000075, "output": 0.0003},
    "gemini-live": {"input": 0.0005, "output": 0.002},
    "claude-3-7-sonnet": {"input": 0.003, "output": 0.015},
    "claude-sonnet-4": {"input": 0.003, "output": 0.015},
    "deepseek-reasoner": {"input": 0.00055, "output": 0.00219},
    "qwen-plus": {"input": 0.0004, "output": 0.0012},
    "qwen-max": {"input": 0.0016, "output": 0.0064},
}

# USD per minute for realtime voice models.
VOICE_PRICING_PER_MINUTE: dict[str, float] = {
    "gemini-2.5-flash-live": 0.012,
    "gemini-2.0-flash-live": 0.010,
    "gemini-live": 0.010,
    "default": 0.010,
}

INR_PER_USD = 83.0


def current_period_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _resolve_pricing(model: str) -> dict[str, float]:
    model_lower = (model or "").lower().removeprefix("models/")
    for key, pricing in MODEL_PRICING.items():
        if key in model_lower or model_lower in key:
            return pricing
    return MODEL_PRICING.get("gpt-4o-mini", {"input": 0.00015, "output": 0.0006})


def _resolve_voice_rate(model: str) -> float:
    model_lower = (model or "").lower()
    for key, rate in VOICE_PRICING_PER_MINUTE.items():
        if key != "default" and key in model_lower:
            return rate
    return VOICE_PRICING_PER_MINUTE["default"]


def estimate_llm_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = _resolve_pricing(model)
    return (max(0, input_tokens) / 1000.0) * pricing.get("input", 0.0) + (
        max(0, output_tokens) / 1000.0
    ) * pricing.get("output", 0.0)


def estimate_voice_cost_usd(model: str, duration_secs: float) -> float:
    minutes = max(0.0, duration_secs) / 60.0
    return minutes * _resolve_voice_rate(model)


def _insert_cost_record_sync(
    *,
    user_id: str,
    capability: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    audio_duration_secs: float,
    estimated_cost_usd: float,
    period_key: str,
    session_id: str | None,
) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ai_cost_records (
                id, user_id, capability, model,
                input_tokens, output_tokens, audio_duration_secs,
                estimated_cost_usd, period_key, session_id, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            """,
            (
                f"cost_{uuid4().hex}",
                user_id,
                capability,
                model,
                input_tokens,
                output_tokens,
                audio_duration_secs,
                estimated_cost_usd,
                period_key,
                session_id,
            ),
        )
        conn.commit()


async def record_llm_cost(
    user_id: str,
    capability: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    session_id: str | None = None,
) -> float:
    """Persist an LLM cost row. Returns estimated USD; never raises."""
    try:
        if not user_id or user_id in {"local-admin", "anonymous", "unknown"}:
            return 0.0
        cost = estimate_llm_cost_usd(model, input_tokens, output_tokens)
        period_key = current_period_key()
        await asyncio.to_thread(
            _insert_cost_record_sync,
            user_id=user_id,
            capability=capability or "llm",
            model=model or "unknown",
            input_tokens=int(input_tokens),
            output_tokens=int(output_tokens),
            audio_duration_secs=0.0,
            estimated_cost_usd=cost,
            period_key=period_key,
            session_id=session_id,
        )
        return cost
    except Exception as exc:
        logger.debug("record_llm_cost failed: %s", exc)
        return 0.0


async def record_voice_cost(
    user_id: str,
    duration_secs: float,
    model: str,
    session_id: str | None = None,
) -> float:
    """Persist a voice session cost row. Returns estimated USD; never raises."""
    try:
        if not user_id or user_id in {"local-admin", "anonymous"}:
            return 0.0
        cost = estimate_voice_cost_usd(model, duration_secs)
        period_key = current_period_key()
        await asyncio.to_thread(
            _insert_cost_record_sync,
            user_id=user_id,
            capability="voice",
            model=model or "gemini-live",
            input_tokens=0,
            output_tokens=0,
            audio_duration_secs=float(duration_secs),
            estimated_cost_usd=cost,
            period_key=period_key,
            session_id=session_id,
        )
        return cost
    except Exception as exc:
        logger.debug("record_voice_cost failed: %s", exc)
        return 0.0


def _get_user_cost_summary_sync(user_id: str, period_key: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(audio_duration_secs), 0) AS audio_duration_secs,
                COUNT(*) AS record_count
            FROM ai_cost_records
            WHERE user_id = %s AND period_key = %s
            """,
            (user_id, period_key),
        )
        totals = dict(cur.fetchone())
        cur.execute(
            """
            SELECT capability,
                   COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
                   COUNT(*) AS calls
            FROM ai_cost_records
            WHERE user_id = %s AND period_key = %s
            GROUP BY capability
            ORDER BY cost_usd DESC
            """,
            (user_id, period_key),
        )
        by_capability = [dict(row) for row in cur.fetchall()]
    return {
        "user_id": user_id,
        "period_key": period_key,
        "total_cost_usd": float(totals["total_cost_usd"]),
        "input_tokens": int(totals["input_tokens"]),
        "output_tokens": int(totals["output_tokens"]),
        "audio_duration_secs": float(totals["audio_duration_secs"]),
        "record_count": int(totals["record_count"]),
        "by_capability": [
            {
                "capability": str(row["capability"]),
                "cost_usd": float(row["cost_usd"]),
                "calls": int(row["calls"]),
            }
            for row in by_capability
        ],
    }


def _get_platform_cost_summary_sync(period_key: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(audio_duration_secs), 0) AS audio_duration_secs,
                COUNT(DISTINCT user_id) AS active_users,
                COUNT(*) AS record_count
            FROM ai_cost_records
            WHERE period_key = %s
            """,
            (period_key,),
        )
        totals = dict(cur.fetchone())
        cur.execute(
            """
            SELECT capability,
                   COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
                   COUNT(*) AS calls
            FROM ai_cost_records
            WHERE period_key = %s
            GROUP BY capability
            ORDER BY cost_usd DESC
            """,
            (period_key,),
        )
        by_capability = [dict(row) for row in cur.fetchall()]
        cur.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS revenue_paise
            FROM payments
            WHERE status = 'paid'
              AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = %s
            """,
            (period_key,),
        )
        revenue_paise = int(cur.fetchone()["revenue_paise"])
        cur.execute(
            """
            SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'
            """
        )
        active_subscriptions = int(cur.fetchone()["count"])
        cur.execute(
            """
            SELECT COALESCE(SUM(p.price_monthly), 0) AS mrr_inr
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active'
            """
        )
        mrr_inr = float(cur.fetchone()["mrr_inr"])
    total_cost = float(totals["total_cost_usd"])
    active_users = max(1, int(totals["active_users"]))
    top_capability = str(by_capability[0]["capability"]) if by_capability else "—"
    revenue_usd = revenue_paise / 100.0 / INR_PER_USD
    mrr_usd = mrr_inr / INR_PER_USD
    return {
        "period_key": period_key,
        "total_cost_usd": total_cost,
        "avg_cost_per_user_usd": total_cost / active_users if int(totals["active_users"]) else 0.0,
        "most_expensive_capability": top_capability,
        "revenue_paise": revenue_paise,
        "revenue_usd": revenue_usd,
        "mrr_inr": mrr_inr,
        "mrr_usd": mrr_usd,
        "mrr_vs_cost_usd": mrr_usd - total_cost,
        "profit_usd": revenue_usd - total_cost,
        "active_users": int(totals["active_users"]),
        "active_subscriptions": active_subscriptions,
        "record_count": int(totals["record_count"]),
        "input_tokens": int(totals["input_tokens"]),
        "output_tokens": int(totals["output_tokens"]),
        "audio_duration_secs": float(totals["audio_duration_secs"]),
        "by_capability": [
            {
                "capability": str(row["capability"]),
                "cost_usd": float(row["cost_usd"]),
                "calls": int(row["calls"]),
            }
            for row in by_capability
        ],
    }


def _get_cost_per_user_sync(period_key: str, limit: int = 50) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                c.user_id,
                au.username,
                COALESCE(SUM(c.estimated_cost_usd), 0) AS cost_usd,
                COALESCE(SUM(c.input_tokens), 0) AS input_tokens,
                COALESCE(SUM(c.output_tokens), 0) AS output_tokens,
                COUNT(*) AS record_count,
                s.plan_id,
                pl.display_name AS plan_display,
                pl.name AS plan_name,
                COALESCE(pay.revenue_paise, 0) AS revenue_paise
            FROM ai_cost_records c
            LEFT JOIN auth_users au ON au.id = c.user_id
            LEFT JOIN subscriptions s ON s.user_id = c.user_id AND s.status = 'active'
            LEFT JOIN plans pl ON pl.id = s.plan_id
            LEFT JOIN (
                SELECT user_id, SUM(amount) AS revenue_paise
                FROM payments
                WHERE status = 'paid'
                  AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = %s
                GROUP BY user_id
            ) pay ON pay.user_id = c.user_id
            WHERE c.period_key = %s
            GROUP BY c.user_id, au.username, s.plan_id, pl.display_name, pl.name, pay.revenue_paise
            ORDER BY cost_usd DESC
            LIMIT %s
            """,
            (period_key, period_key, limit),
        )
        rows = cur.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        record = dict(row)
        cost_usd = float(record["cost_usd"])
        revenue_usd = int(record["revenue_paise"]) / 100.0 / INR_PER_USD
        profit_usd = revenue_usd - cost_usd
        results.append(
            {
                "user_id": str(record["user_id"]),
                "username": str(record.get("username") or ""),
                "cost_usd": cost_usd,
                "revenue_usd": revenue_usd,
                "revenue_paise": int(record["revenue_paise"]),
                "profit_usd": profit_usd,
                "profitable": profit_usd >= 0,
                "input_tokens": int(record["input_tokens"]),
                "output_tokens": int(record["output_tokens"]),
                "record_count": int(record["record_count"]),
                "plan_id": str(record["plan_id"]) if record.get("plan_id") else None,
                "plan_display": str(record.get("plan_display") or "Free"),
                "plan_name": str(record.get("plan_name") or "free"),
            }
        )
    return results


def _plan_profitability_sync(period_key: str) -> list[dict[str, Any]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH plan_users AS (
                SELECT s.plan_id, s.user_id
                FROM subscriptions s
                WHERE s.status = 'active'
            ),
            plan_costs AS (
                SELECT pu.plan_id,
                       AVG(user_cost.total_cost) AS avg_cost_usd,
                       COUNT(DISTINCT pu.user_id) AS user_count
                FROM plan_users pu
                JOIN (
                    SELECT user_id, SUM(estimated_cost_usd) AS total_cost
                    FROM ai_cost_records
                    WHERE period_key = %s
                    GROUP BY user_id
                ) user_cost ON user_cost.user_id = pu.user_id
                GROUP BY pu.plan_id
            ),
            plan_revenue AS (
                SELECT p.plan_id,
                       AVG(p.amount / 100.0 / %s) AS avg_revenue_usd
                FROM payments p
                WHERE p.status = 'paid'
                  AND to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM') = %s
                GROUP BY p.plan_id
            )
            SELECT
                pl.id AS plan_id,
                pl.display_name,
                pl.name,
                pl.price_monthly,
                COALESCE(pc.avg_cost_usd, 0) AS avg_cost_usd,
                COALESCE(pc.user_count, 0) AS active_users,
                COALESCE(pr.avg_revenue_usd, pl.price_monthly / %s) AS avg_revenue_usd
            FROM plans pl
            LEFT JOIN plan_costs pc ON pc.plan_id = pl.id
            LEFT JOIN plan_revenue pr ON pr.plan_id = pl.id
            WHERE pl.is_active = TRUE
            ORDER BY pl.display_name ASC
            """,
            (period_key, INR_PER_USD, period_key, INR_PER_USD),
        )
        rows = cur.fetchall()
    return [
        {
            "plan_id": str(row["plan_id"]),
            "display_name": str(row["display_name"]),
            "name": str(row["name"]),
            "price_monthly_inr": float(row["price_monthly"]),
            "avg_cost_usd": float(row["avg_cost_usd"]),
            "avg_revenue_usd": float(row["avg_revenue_usd"]),
            "avg_profit_usd": float(row["avg_revenue_usd"]) - float(row["avg_cost_usd"]),
            "active_users": int(row["active_users"]),
        }
        for row in rows
    ]


async def get_user_cost_summary(user_id: str, period_key: str) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(_get_user_cost_summary_sync, user_id, period_key)
    except Exception as exc:
        logger.debug("get_user_cost_summary failed: %s", exc)
        return {
            "user_id": user_id,
            "period_key": period_key,
            "total_cost_usd": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "audio_duration_secs": 0.0,
            "record_count": 0,
            "by_capability": [],
        }


async def get_platform_cost_summary(period_key: str) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(_get_platform_cost_summary_sync, period_key)
    except Exception as exc:
        logger.debug("get_platform_cost_summary failed: %s", exc)
        return {
            "period_key": period_key,
            "total_cost_usd": 0.0,
            "avg_cost_per_user_usd": 0.0,
            "most_expensive_capability": "—",
            "revenue_paise": 0,
            "revenue_usd": 0.0,
            "mrr_inr": 0.0,
            "mrr_usd": 0.0,
            "mrr_vs_cost_usd": 0.0,
            "profit_usd": 0.0,
            "active_users": 0,
            "active_subscriptions": 0,
            "record_count": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "audio_duration_secs": 0.0,
            "by_capability": [],
        }


async def get_cost_per_user(period_key: str, limit: int = 50) -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(_get_cost_per_user_sync, period_key, limit)
    except Exception as exc:
        logger.debug("get_cost_per_user failed: %s", exc)
        return []


async def get_plan_profitability(period_key: str) -> list[dict[str, Any]]:
    try:
        return await asyncio.to_thread(_plan_profitability_sync, period_key)
    except Exception as exc:
        logger.debug("get_plan_profitability failed: %s", exc)
        return []
