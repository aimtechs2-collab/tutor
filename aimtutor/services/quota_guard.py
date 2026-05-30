"""Quota enforcement helpers for feature entry points."""

from __future__ import annotations

from fastapi import HTTPException, status

from aimtutor.services.quota import check_quota, record_usage


def _skip_quota(user_id: str | None) -> bool:
    return not user_id or user_id in {"local-admin", "anonymous"}


async def enforce_quota(user_id: str, metric: str, amount: float = 1.0) -> None:
    """Raise HTTP 429 when the user would exceed their plan limit."""
    if _skip_quota(user_id):
        return
    allowed, used, limit = await check_quota(user_id, metric)
    if limit == -1:
        return
    if used + amount > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "quota_exceeded",
                "metric": metric,
                "used": used,
                "limit": limit,
            },
        )
    if not allowed and amount <= 1:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "quota_exceeded",
                "metric": metric,
                "used": used,
                "limit": limit,
            },
        )


async def enforce_and_record(user_id: str, metric: str, amount: float = 1.0) -> None:
    await enforce_quota(user_id, metric, amount)
    if _skip_quota(user_id):
        return
    await record_usage(user_id, metric, amount)
