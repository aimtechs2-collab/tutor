"""Optional Clerk JWT verification for AIMTutor.

Clerk is active only when ``CLERK_SECRET_KEY`` is present. Without that env var,
the existing local/Postgres auth flow remains the source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
import time
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

CLERK_JWKS_URL = "https://api.clerk.com/v1/jwks"
CLERK_ENABLED = bool(os.environ.get("CLERK_SECRET_KEY"))
_JWKS_TTL_SECONDS = 300

security = HTTPBearer(auto_error=False)


@dataclass
class _JwksCache:
    payload: dict[str, Any]
    expires_at: float


_jwks_cache: _JwksCache | None = None


async def get_clerk_jwks() -> dict[str, Any]:
    global _jwks_cache
    now = time.time()
    if _jwks_cache and _jwks_cache.expires_at > now:
        return _jwks_cache.payload

    secret = os.environ.get("CLERK_SECRET_KEY")
    if not secret:
        raise RuntimeError("CLERK_SECRET_KEY is not configured")

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            CLERK_JWKS_URL,
            headers={"Authorization": f"Bearer {secret}"},
        )
        response.raise_for_status()
        payload = response.json()
    _jwks_cache = _JwksCache(payload=payload, expires_at=now + _JWKS_TTL_SECONDS)
    return payload


def _role_from_claims(claims: dict[str, Any]) -> str:
    metadata = claims.get("publicMetadata") or claims.get("public_metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    role = str(claims.get("role") or metadata.get("role") or "user")
    return role if role in {"admin", "user"} else "user"


def clerk_token_payload(claims: dict[str, Any]):
    from aimtutor.services.auth import TokenPayload

    user_id = str(claims.get("sub") or claims.get("userId") or claims.get("user_id") or "")
    username = str(
        claims.get("email")
        or claims.get("primary_email_address")
        or claims.get("username")
        or user_id
        or "clerk-user"
    )
    return TokenPayload(username=username, role=_role_from_claims(claims), user_id=user_id)


async def verify_clerk_token(token: str) -> dict[str, Any]:
    try:
        jwks = await get_clerk_jwks()
        header = jwt.get_unverified_header(token)
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
        if not key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown signing key")
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except HTTPException:
        raise
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Clerk token: {exc}",
        ) from exc


async def get_current_user_clerk(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any] | None:
    if not CLERK_ENABLED:
        return None
    if not credentials:
        return None
    return await verify_clerk_token(credentials.credentials)


async def require_clerk_user(
    claims: dict[str, Any] | None = Depends(get_current_user_clerk),
) -> dict[str, Any]:
    if not claims:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return claims


def is_admin(claims: dict[str, Any]) -> bool:
    return _role_from_claims(claims) == "admin"


async def require_admin(claims: dict[str, Any] = Depends(require_clerk_user)) -> dict[str, Any]:
    if not is_admin(claims):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return claims


@lru_cache(maxsize=1)
def clerk_is_enabled() -> bool:
    return bool(os.environ.get("CLERK_SECRET_KEY"))
