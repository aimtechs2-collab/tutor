"""Optional Clerk JWT verification for AIMTutor.

Clerk is active only when ``CLERK_SECRET_KEY`` is present. Without that env var,
the existing local/Postgres auth flow remains the source of truth.
"""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from functools import lru_cache
import json
import logging
import os
from pathlib import Path
import time
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

CLERK_JWKS_URL = "https://api.clerk.com/v1/jwks"
logger = logging.getLogger(__name__)


def _clerk_requested() -> bool:
    return os.environ.get("AUTH_PROVIDER", "").strip().lower() == "clerk"


CLERK_ENABLED = _clerk_requested() and bool(os.environ.get("CLERK_SECRET_KEY"))
_JWKS_TTL_SECONDS = 300

security = HTTPBearer(auto_error=False)


@dataclass
class _JwksCache:
    payload: dict[str, Any]
    expires_at: float


_jwks_cache: _JwksCache | None = None
_jwks_lock = asyncio.Lock()


def _clerk_frontend_api_host() -> str | None:
    explicit = os.environ.get("CLERK_FRONTEND_API", "").strip()
    if explicit:
        return explicit.replace("https://", "").replace("http://", "").rstrip("/")
    publishable = os.environ.get("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "").strip()
    if publishable.count("_") >= 2:
        try:
            return base64.b64decode(publishable.split("_", 2)[2]).decode().rstrip("$")
        except Exception:
            pass
    return None


def _jwks_fetch_targets() -> list[tuple[str, bool]]:
    """Return (url, use_bearer_auth) pairs, instance JWKS first."""
    targets: list[tuple[str, bool]] = []
    host = _clerk_frontend_api_host()
    if host:
        targets.append((f"https://{host}/.well-known/jwks.json", False))
    targets.append((CLERK_JWKS_URL, True))
    return targets


async def get_clerk_jwks() -> dict[str, Any]:
    global _jwks_cache
    now = time.time()
    if _jwks_cache and _jwks_cache.expires_at > now:
        return _jwks_cache.payload

    async with _jwks_lock:
        now = time.time()
        if _jwks_cache and _jwks_cache.expires_at > now:
            return _jwks_cache.payload

        secret = os.environ.get("CLERK_SECRET_KEY")
        if not secret:
            raise RuntimeError("CLERK_SECRET_KEY is not configured")

        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=20) as client:
            for url, use_bearer in _jwks_fetch_targets():
                headers = (
                    {"Authorization": f"Bearer {secret}"} if use_bearer else None
                )
                try:
                    response = await client.get(url, headers=headers)
                    response.raise_for_status()
                    payload = response.json()
                    _jwks_cache = _JwksCache(
                        payload=payload, expires_at=now + _JWKS_TTL_SECONDS
                    )
                    return payload
                except Exception as exc:
                    last_error = exc
                    logger.warning("Clerk JWKS fetch failed for %s: %s", url, exc)

        if _jwks_cache:
            logger.warning("Using stale Clerk JWKS cache after fetch failures")
            return _jwks_cache.payload

        raise RuntimeError("Failed to fetch Clerk JWKS") from last_error


def _role_from_claims(claims: dict[str, Any]) -> str:
    metadata = claims.get("publicMetadata") or claims.get("public_metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    role = str(claims.get("role") or metadata.get("role") or "user")
    return role if role in {"admin", "user"} else "user"


def _email_from_claims(claims: dict[str, Any]) -> str:
    return str(
        claims.get("email")
        or claims.get("primary_email_address")
        or claims.get("username")
        or ""
    )


def _registry_path() -> Path:
    return Path("data") / "multi-user" / "_system" / "users.json"


def _load_user_registry() -> dict[str, Any]:
    path = _registry_path()
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception:
        return {}


def _save_user_registry(registry: dict[str, Any]) -> None:
    path = _registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, indent=2), encoding="utf-8")


def _bootstrap_or_lookup_local_role(claims: dict[str, Any], claimed_role: str) -> str:
    """Keep Clerk role usable before webhooks/JWT metadata are configured.

    Production Clerk role still lives in ``publicMetadata.role``. This fallback
    only prevents a fresh local AIMTutor install from locking its first signed-in
    Clerk user out of model configuration before the webhook/JWT template exists.
    """
    user_id = str(claims.get("sub") or claims.get("userId") or claims.get("user_id") or "")
    if not user_id:
        return claimed_role

    registry = _load_user_registry()
    has_active_admin = any(
        isinstance(item, dict)
        and item.get("status", "active") == "active"
        and item.get("role") == "admin"
        for item in registry.values()
    )
    existing = registry.get(user_id)
    if isinstance(existing, dict):
        role = str(existing.get("role") or claimed_role)
        if (claimed_role == "admin" or not has_active_admin) and role != "admin":
            existing["role"] = "admin"
            _save_user_registry(registry)
            return "admin"
        return role if role in {"admin", "user"} else claimed_role

    active_users = [
        item
        for item in registry.values()
        if isinstance(item, dict) and item.get("status", "active") == "active"
    ]
    role = "admin" if len(active_users) == 0 else claimed_role
    registry[user_id] = {
        "workspace_dir": f"multi-user/{user_id}",
        "email": _email_from_claims(claims),
        "name": str(claims.get("name") or _email_from_claims(claims) or user_id),
        "role": role,
        "created_at": int(time.time()),
        "last_active": int(time.time()),
        "status": "active",
    }
    _save_user_registry(registry)
    return role


def clerk_token_payload(claims: dict[str, Any]):
    from aimtutor.services.auth import TokenPayload

    user_id = str(claims.get("sub") or claims.get("userId") or claims.get("user_id") or "")
    username = str(
        _email_from_claims(claims)
        or user_id
        or "clerk-user"
    )
    claimed_role = _role_from_claims(claims)
    role = _bootstrap_or_lookup_local_role(claims, claimed_role)
    return TokenPayload(username=username, role=role, user_id=user_id)


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
    return _bootstrap_or_lookup_local_role(claims, _role_from_claims(claims)) == "admin"


async def require_admin(claims: dict[str, Any] = Depends(require_clerk_user)) -> dict[str, Any]:
    if not is_admin(claims):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return claims


@lru_cache(maxsize=1)
def clerk_is_enabled() -> bool:
    return _clerk_requested() and bool(os.environ.get("CLERK_SECRET_KEY"))
