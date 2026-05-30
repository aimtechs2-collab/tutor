"""Razorpay billing endpoints for subscriptions."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator

from aimtutor.api.routers.auth import require_admin, require_auth, require_finance_admin
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.context import get_current_user
from aimtutor.services.billing import (
    create_order,
    get_billing_me,
    handle_webhook,
    list_admin_payments,
    refund_payment,
    verify_and_capture_payment,
)
from aimtutor.services.cost_tracker import (
    current_period_key,
    get_cost_per_user,
    get_plan_profitability,
    get_platform_cost_summary,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateOrderRequest(BaseModel):
    plan_id: str
    period_months: int = 1

    @field_validator("period_months")
    @classmethod
    def period_valid(cls, value: int) -> int:
        if value not in (1, 12):
            raise ValueError("period_months must be 1 or 12")
        return value


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class RefundRequest(BaseModel):
    payment_id: str
    amount_paise: int | None = None


@router.post("/api/v1/billing/create-order")
async def billing_create_order(
    body: CreateOrderRequest,
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    try:
        return await create_order(user.id, body.plan_id, body.period_months)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to create Razorpay order for user %s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create payment order",
        ) from exc


@router.post("/api/v1/billing/verify-payment")
async def billing_verify_payment(
    body: VerifyPaymentRequest,
    _: Any = Depends(require_auth),
) -> dict[str, Any]:
    user = get_current_user()
    try:
        return await verify_and_capture_payment(
            user.id,
            body.razorpay_order_id,
            body.razorpay_payment_id,
            body.razorpay_signature,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Payment verification failed for user %s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Payment verification failed",
        ) from exc


@router.post("/api/v1/billing/webhook")
async def billing_webhook(request: Request) -> dict[str, Any]:
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    try:
        return await handle_webhook(body, signature)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Razorpay webhook processing failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook processing failed",
        ) from exc


@router.get("/api/v1/billing/me")
async def billing_me(_: Any = Depends(require_auth)) -> dict[str, Any]:
    user = get_current_user()
    return await get_billing_me(user.id)


@router.get("/api/v1/admin/billing/payments")
async def admin_billing_payments(
    limit: int = 100,
    offset: int = 0,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    return await list_admin_payments(max(1, min(limit, 500)), max(0, offset))


@router.get("/api/v1/admin/billing/ai-costs")
async def admin_billing_ai_costs(
    period_key: str | None = None,
    limit: int = 50,
    _: Any = Depends(require_admin),
) -> dict[str, Any]:
    key = period_key or current_period_key()
    platform = await get_platform_cost_summary(key)
    users = await get_cost_per_user(key, max(1, min(limit, 200)))
    plans = await get_plan_profitability(key)
    return {
        "period_key": key,
        "platform": platform,
        "users": users,
        "plans": plans,
    }


@router.post("/api/v1/admin/billing/refund")
async def admin_billing_refund(
    body: RefundRequest,
    _: Any = Depends(require_finance_admin),
) -> dict[str, Any]:
    try:
        result = await refund_payment(body.payment_id, body.amount_paise)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Refund failed for payment %s", body.payment_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Refund failed",
        ) from exc
    log_admin_action(
        "refund_payment",
        target_user_id=str(result["payment"].get("user_id") or ""),
        summary={
            "payment_id": body.payment_id,
            "amount_paise": body.amount_paise,
        },
    )
    return result
