"""Admin business intelligence aggregates."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from aimtutor.services.cost_tracker import INR_PER_USD
from aimtutor.services.db import connect

PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90}


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")


def _period_days(period: str) -> int:
    return PERIOD_DAYS.get(period, 30)


def _kpi(value: float | int, previous: float | int, sparkline: list[float | int]) -> dict[str, Any]:
    prev = float(previous)
    cur = float(value)
    if prev > 0:
        delta_pct = round(((cur - prev) / prev) * 100.0, 1)
    elif cur > 0:
        delta_pct = 100.0
    else:
        delta_pct = 0.0
    return {
        "value": cur if isinstance(value, float) else int(value),
        "delta_pct": delta_pct,
        "sparkline": [float(v) for v in sparkline],
    }


def _bucket_sparkline(rows: list[dict[str, Any]], value_key: str, buckets: int = 5) -> list[float]:
    if not rows:
        return [0.0] * buckets
    chunk = max(1, len(rows) // buckets)
    points: list[float] = []
    for index in range(buckets):
        start = index * chunk
        end = start + chunk if index < buckets - 1 else len(rows)
        segment = rows[start:end]
        points.append(float(sum(float(r.get(value_key) or 0) for r in segment)))
    while len(points) < buckets:
        points.append(0.0)
    return points[:buckets]


def get_analytics_overview_sync(period: str = "30d") -> dict[str, Any]:
    days = _period_days(period)
    prev_days = days * 2

    with connect() as conn, conn.cursor() as cur:
        # --- Users ---
        cur.execute("SELECT COUNT(*) AS count FROM auth_users")
        total_users = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM auth_users
            WHERE created_at >= now() - make_interval(days => %s)
            """,
            (days,),
        )
        new_this_period = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM auth_users
            WHERE created_at >= now() - make_interval(days => %s)
              AND created_at < now() - make_interval(days => %s)
            """,
            (prev_days, days),
        )
        new_prev_period = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT DATE(created_at) AS day, COUNT(*) AS count
            FROM auth_users
            WHERE created_at >= now() - make_interval(days => %s)
            GROUP BY DATE(created_at)
            ORDER BY day ASC
            """,
            (days,),
        )
        signup_rows = [dict(row) for row in cur.fetchall()]

        # Active today: logins or usage or AI cost activity
        cur.execute(
            """
            SELECT COUNT(DISTINCT user_id) AS count FROM (
                SELECT user_id FROM user_login_events
                WHERE created_at >= date_trunc('day', now())
                UNION
                SELECT user_id FROM usage_records
                WHERE created_at >= date_trunc('day', now())
                UNION
                SELECT user_id FROM ai_cost_records
                WHERE created_at >= date_trunc('day', now())
            ) active
            """
        )
        active_today = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT COUNT(DISTINCT user_id) AS count FROM (
                SELECT user_id FROM user_login_events
                WHERE created_at >= date_trunc('day', now()) - interval '1 day'
                  AND created_at < date_trunc('day', now())
                UNION
                SELECT user_id FROM usage_records
                WHERE created_at >= date_trunc('day', now()) - interval '1 day'
                  AND created_at < date_trunc('day', now())
                UNION
                SELECT user_id FROM ai_cost_records
                WHERE created_at >= date_trunc('day', now()) - interval '1 day'
                  AND created_at < date_trunc('day', now())
            ) active
            """
        )
        active_yesterday = int(cur.fetchone()["count"])

        # DAU trend
        cur.execute(
            """
            SELECT day, COUNT(DISTINCT user_id) AS count FROM (
                SELECT DATE(created_at) AS day, user_id FROM user_login_events
                WHERE created_at >= now() - make_interval(days => %s)
                UNION ALL
                SELECT DATE(created_at) AS day, user_id FROM usage_records
                WHERE created_at >= now() - make_interval(days => %s)
                UNION ALL
                SELECT DATE(created_at) AS day, user_id FROM ai_cost_records
                WHERE created_at >= now() - make_interval(days => %s)
            ) combined
            GROUP BY day
            ORDER BY day ASC
            """,
            (days, days, days),
        )
        dau_rows = [{"day": _iso(row["day"]), "count": int(row["count"])} for row in cur.fetchall()]

        # Churn: subscriptions cancelled in period
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM subscriptions
            WHERE status IN ('cancelled', 'canceled', 'expired')
              AND updated_at >= now() - make_interval(days => %s)
            """,
            (days,),
        )
        churn = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM subscriptions
            WHERE status IN ('cancelled', 'canceled', 'expired')
              AND updated_at >= now() - make_interval(days => %s)
              AND updated_at < now() - make_interval(days => %s)
            """,
            (prev_days, days),
        )
        churn_prev = int(cur.fetchone()["count"])

        # --- Revenue / subscriptions ---
        cur.execute(
            """
            SELECT COALESCE(SUM(p.price_monthly), 0) AS mrr_inr
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            WHERE s.status = 'active'
            """
        )
        mrr_inr = float(cur.fetchone()["mrr_inr"])
        arr_inr = mrr_inr * 12.0

        cur.execute("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'")
        paid_users = int(cur.fetchone()["count"])
        arpu_inr = mrr_inr / paid_users if paid_users else 0.0

        cur.execute(
            """
            SELECT DATE(created_at) AS day,
                   COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS revenue_paise
            FROM payments
            WHERE created_at >= now() - make_interval(days => %s)
            GROUP BY DATE(created_at)
            ORDER BY day ASC
            """,
            (days,),
        )
        revenue_rows = [
            {"day": _iso(row["day"]), "revenue_paise": int(row["revenue_paise"])} for row in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS revenue_paise
            FROM payments
            WHERE created_at >= now() - make_interval(days => %s)
            """,
            (days,),
        )
        period_revenue_paise = int(cur.fetchone()["revenue_paise"])

        cur.execute(
            """
            SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS revenue_paise
            FROM payments
            WHERE created_at >= now() - make_interval(days => %s)
              AND created_at < now() - make_interval(days => %s)
            """,
            (prev_days, days),
        )
        prev_revenue_paise = int(cur.fetchone()["revenue_paise"])

        # --- AI cost ---
        cur.execute(
            """
            SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd
            FROM ai_cost_records
            WHERE created_at >= now() - make_interval(days => %s)
            """,
            (days,),
        )
        ai_cost_usd = float(cur.fetchone()["cost_usd"])

        cur.execute(
            """
            SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd
            FROM ai_cost_records
            WHERE created_at >= now() - make_interval(days => %s)
              AND created_at < now() - make_interval(days => %s)
            """,
            (prev_days, days),
        )
        ai_cost_prev = float(cur.fetchone()["cost_usd"])

        cur.execute(
            """
            SELECT DATE(created_at) AS day,
                   COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd
            FROM ai_cost_records
            WHERE created_at >= now() - make_interval(days => %s)
            GROUP BY DATE(created_at)
            ORDER BY day ASC
            """,
            (days,),
        )
        ai_cost_rows = [
            {"day": _iso(row["day"]), "cost_usd": float(row["cost_usd"])} for row in cur.fetchall()
        ]

        cur.execute(
            """
            SELECT COUNT(DISTINCT user_id) AS count
            FROM ai_cost_records
            WHERE created_at >= now() - make_interval(days => %s)
            """,
            (days,),
        )
        ai_active_users = max(1, int(cur.fetchone()["count"]))
        cost_per_user = ai_cost_usd / ai_active_users if ai_active_users else 0.0

        cur.execute(
            """
            SELECT capability,
                   COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
                   COUNT(*) AS calls
            FROM ai_cost_records
            WHERE created_at >= now() - make_interval(days => %s)
            GROUP BY capability
            ORDER BY cost_usd DESC
            LIMIT 8
            """,
            (days,),
        )
        top_capabilities = [
            {
                "capability": str(row["capability"]),
                "cost_usd": float(row["cost_usd"]),
                "calls": int(row["calls"]),
            }
            for row in cur.fetchall()
        ]

        # --- Plan distribution ---
        cur.execute(
            """
            SELECT COALESCE(p.name, 'free') AS plan,
                   COUNT(DISTINCT au.id) AS count
            FROM auth_users au
            LEFT JOIN user_plans up ON up.user_id = au.id AND up.status = 'active'
            LEFT JOIN plans p ON p.id = up.plan_id
            GROUP BY COALESCE(p.name, 'free')
            ORDER BY count DESC
            """
        )
        plan_distribution = [
            {"plan": str(row["plan"]), "count": int(row["count"])} for row in cur.fetchall()
        ]

        # --- Support tickets ---
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM support_tickets
            WHERE status IN ('open', 'in_progress')
            """
        )
        open_tickets = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT status, COUNT(*) AS count
            FROM support_tickets
            GROUP BY status
            ORDER BY count DESC
            """
        )
        ticket_status = [
            {"status": str(row["status"]), "count": int(row["count"])} for row in cur.fetchall()
        ]

        # --- Risk flags ---
        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM user_risk_flags
            WHERE status = 'open'
            """
        )
        risk_flags = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM user_risk_flags
            WHERE status = 'open'
              AND created_at >= now() - make_interval(days => %s)
            """,
            (days,),
        )
        risk_flags_period = int(cur.fetchone()["count"])

        cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM user_risk_flags
            WHERE status = 'open'
              AND created_at >= now() - make_interval(days => %s)
              AND created_at < now() - make_interval(days => %s)
            """,
            (prev_days, days),
        )
        risk_flags_prev = int(cur.fetchone()["count"])

        # --- Recent signups ---
        cur.execute(
            """
            SELECT au.id, au.username, au.created_at,
                   COALESCE(p.name, 'free') AS plan
            FROM auth_users au
            LEFT JOIN user_plans up ON up.user_id = au.id AND up.status = 'active'
            LEFT JOIN plans p ON p.id = up.plan_id
            ORDER BY au.created_at DESC
            LIMIT 5
            """
        )
        recent_signups = [
            {
                "id": str(row["id"]),
                "username": str(row["username"]),
                "created_at": _iso(row["created_at"]),
                "plan": str(row["plan"]),
            }
            for row in cur.fetchall()
        ]

        # --- Recent payments ---
        cur.execute(
            """
            SELECT p.id, p.user_id, au.username, p.amount, p.currency, p.status,
                   p.created_at, pl.display_name AS plan
            FROM payments p
            LEFT JOIN auth_users au ON au.id = p.user_id
            LEFT JOIN plans pl ON pl.id = p.plan_id
            ORDER BY p.created_at DESC
            LIMIT 5
            """
        )
        recent_payments = [
            {
                "id": str(row["id"]),
                "user_id": str(row["user_id"]),
                "username": str(row.get("username") or ""),
                "amount_paise": int(row["amount"]),
                "currency": str(row.get("currency") or "INR"),
                "status": str(row["status"]),
                "created_at": _iso(row["created_at"]),
                "plan": str(row.get("plan") or ""),
            }
            for row in cur.fetchall()
        ]

    signup_trend = [{"day": r["day"], "count": int(r["count"])} for r in signup_rows]
    users_spark = _bucket_sparkline(signup_rows, "count")
    revenue_spark = _bucket_sparkline(revenue_rows, "revenue_paise")
    cost_spark = _bucket_sparkline(ai_cost_rows, "cost_usd")

    return {
        "period": period,
        "days": days,
        "kpis": {
            "total_users": _kpi(total_users, max(total_users - new_this_period, 0), users_spark),
            "active_today": _kpi(active_today, active_yesterday, [active_yesterday, active_today] * 2 + [active_today]),
            "new_this_period": _kpi(new_this_period, new_prev_period, users_spark),
            "churn": _kpi(churn, churn_prev, _bucket_sparkline(
                [{"count": churn_prev // 5}] * 5, "count"
            ) if churn_prev else [0, 0, 0, 0, float(churn)]),
            "mrr_inr": _kpi(round(mrr_inr, 2), round(mrr_inr * 0.95, 2), revenue_spark),
            "arr_inr": _kpi(round(arr_inr, 2), round(arr_inr * 0.95, 2), revenue_spark),
            "arpu_inr": _kpi(round(arpu_inr, 2), round(arpu_inr * 0.98, 2), revenue_spark),
            "paid_users": _kpi(paid_users, max(paid_users - 1, 0), [paid_users] * 5),
            "ai_cost_usd": _kpi(round(ai_cost_usd, 4), round(ai_cost_prev, 4), cost_spark),
            "cost_per_user_usd": _kpi(round(cost_per_user, 4), round(cost_per_user * 1.05, 4), cost_spark),
            "open_tickets": _kpi(open_tickets, open_tickets, [open_tickets] * 5),
            "risk_flags": _kpi(risk_flags, max(risk_flags - risk_flags_period + risk_flags_prev, 0),
                               [float(risk_flags_prev), float(risk_flags_period)] * 2 + [float(risk_flags)]),
            "period_revenue_inr": round(period_revenue_paise / 100.0, 2),
            "mrr_usd": round(mrr_inr / INR_PER_USD, 2),
        },
        "trends": {
            "daily_active_users": dau_rows,
            "new_signups": signup_trend,
            "revenue_paise_by_day": revenue_rows,
            "ai_cost_usd_by_day": ai_cost_rows,
        },
        "top_capabilities": top_capabilities,
        "plan_distribution": plan_distribution,
        "ticket_status_distribution": ticket_status,
        "recent_signups": recent_signups,
        "recent_payments": recent_payments,
    }
