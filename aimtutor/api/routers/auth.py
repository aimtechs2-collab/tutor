"""Auth router — login, logout, status, registration, and user-management endpoints."""

from contextvars import Token as _CtxToken
import logging

import bcrypt
from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    Header,
    HTTPException,
    Response,
    WebSocket,
    status,
)
from pydantic import BaseModel, field_validator

from aimtutor.auth_clerk import (
    clerk_is_enabled,
    clerk_token_payload,
    is_admin as clerk_claims_is_admin,
    verify_clerk_token,
)
from aimtutor.multi_user.audit import log_admin_action
from aimtutor.multi_user.identity import (
    ban_user,
    reset_user_password,
    set_admin_role,
    suspend_user,
    unsuspend_user,
)
from aimtutor.services.config import load_auth_settings

# SameSite=None lets the cookie work when the browser accesses the frontend via
# 127.0.0.1 and the backend via localhost (different origins on the same machine).
# Browsers require Secure=True for SameSite=None, but that needs HTTPS — so in
# local dev we fall back to SameSite=Lax and tell users to use localhost:// URLs.
_SECURE = bool(load_auth_settings()["cookie_secure"])
_SAMESITE = "none" if _SECURE else "lax"

from aimtutor.services.auth import (
    AUTH_ENABLED,
    POCKETBASE_ENABLED,
    TOKEN_EXPIRE_HOURS,
    TokenPayload,
    add_user,
    authenticate,
    authenticate_pb,
    create_token,
    decode_token,
    delete_user,
    is_first_user,
    list_users,
    register_pb,
    set_role,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_COOKIE_NAME = "dt_token"
_COOKIE_MAX_AGE = TOKEN_EXPIRE_HOURS * 3600


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    """Payload for the POST /login endpoint."""

    username: str
    password: str


class RegisterRequest(BaseModel):
    """Payload for the POST /register endpoint."""

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        import re

        v = v.strip()
        if not v:
            raise ValueError("Email cannot be empty")
        # Accept standard email addresses (used by PocketBase mode) or plain
        # usernames (used by the built-in SQLite/JSON auth mode).
        email_re = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
        plain_re = re.compile(r"^[A-Za-z0-9_\-.]{3,64}$")
        if not email_re.match(v) and not plain_re.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class SetRoleRequest(BaseModel):
    """Payload for the PUT /users/{username}/role endpoint."""

    role: str

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in ("admin", "user"):
            raise ValueError("Role must be 'admin' or 'user'")
        return v


class SuspendRequest(BaseModel):
    """Payload for the POST /users/{user_id}/suspend endpoint."""

    reason: str = ""


class BanRequest(BaseModel):
    """Payload for the POST /users/{user_id}/ban endpoint."""

    reason: str = ""


class ResetPasswordRequest(BaseModel):
    """Payload for the POST /users/{user_id}/reset-password endpoint."""

    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_valid(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class AuthStatusResponse(BaseModel):
    """Response body for the GET /status endpoint."""

    enabled: bool
    authenticated: bool
    user_id: str | None = None
    username: str | None = None
    role: str | None = None
    is_admin: bool = False
    admin_role: str | None = None


class SetAdminRoleRequest(BaseModel):
    """Payload for the POST /users/{user_id}/admin-role endpoint."""

    admin_role: str | None = None

    @field_validator("admin_role")
    @classmethod
    def admin_role_valid(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        allowed = {
            "super_admin",
            "admin",
            "support_agent",
            "finance_admin",
            "ai_safety_admin",
            "tutor_manager",
        }
        if value not in allowed:
            raise ValueError(f"admin_role must be one of {sorted(allowed)}")
        return value


class UserInfo(BaseModel):
    """Single user record returned by the GET /users endpoint."""

    id: str = ""
    username: str
    role: str
    created_at: str
    disabled: bool = False
    suspended_at: str = ""
    suspension_reason: str = ""
    banned: bool = False
    ban_reason: str = ""
    admin_role: str | None = None


# ---------------------------------------------------------------------------
# Shared helper — extract token from cookie or Bearer header
# ---------------------------------------------------------------------------


def _bearer_token_from_header(authorization: str | None) -> str | None:
    """Parse ``Authorization: Bearer <token>`` without using ``HTTPBearer``.

    ``HTTPBearer`` is a class-based dependency whose ``__call__`` is annotated
    ``request: Request``. FastAPI doesn't inject a Request into WebSocket
    dependency resolution, which makes ``HTTPBearer`` raise ``TypeError`` the
    moment a router with this dep mounts a WS endpoint. Doing the parse by
    hand keeps ``require_auth`` HTTP/WS-symmetric.
    """
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        token = parts[1].strip()
        return token or None
    return None


def _extract_token(authorization: str | None, dt_token: str | None) -> str | None:
    return _bearer_token_from_header(authorization) or dt_token


def _account_status_error(user_id: str | None) -> str | None:
    if not user_id or user_id == "local-admin":
        return None
    from aimtutor.multi_user.identity import get_user_by_id

    result = get_user_by_id(user_id)
    if result is None:
        return "User not found"
    record = result[1]
    if bool(record.get("banned")):
        return "Account banned"
    if bool(record.get("disabled")):
        return "Account suspended"
    return None


def _raise_if_account_blocked(user_id: str | None) -> None:
    detail = _account_status_error(user_id)
    if detail:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# ---------------------------------------------------------------------------
# Dependencies — reusable auth guards for other routers
# ---------------------------------------------------------------------------


async def require_auth(
    authorization: str | None = Header(default=None, alias="Authorization"),
    dt_token: str | None = Cookie(default=None),
) -> TokenPayload | None:
    """
    FastAPI dependency that enforces authentication when AUTH_ENABLED=true.

    Accepts the JWT from either:
      - Authorization: Bearer <token> header
      - dt_token cookie

    Works on both HTTP and WebSocket routes — ``Header`` and ``Cookie`` are
    WS-compatible, while ``HTTPBearer`` (which we used to use here) is not.

    Returns the authenticated TokenPayload, or None if auth is disabled.
    Raises HTTP 401 if auth is enabled but the token is missing or invalid.
    """
    if clerk_is_enabled():
        token = _bearer_token_from_header(authorization)
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        claims = await verify_clerk_token(token)
        payload = clerk_token_payload(claims)
        from aimtutor.multi_user.context import set_current_user, user_from_token_payload

        set_current_user(user_from_token_payload(payload))
        return payload

    if not AUTH_ENABLED:
        from aimtutor.multi_user.context import set_current_user
        from aimtutor.multi_user.paths import local_admin_user

        set_current_user(local_admin_user())
        return None

    token = _extract_token(authorization, dt_token)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    _raise_if_account_blocked(payload.user_id)

    from aimtutor.multi_user.context import set_current_user, user_from_token_payload

    set_current_user(user_from_token_payload(payload))
    return payload


class _WsAuthFailed:
    """Sentinel: ws_require_auth failed and closed the WebSocket."""


ws_auth_failed: _WsAuthFailed = _WsAuthFailed()


async def ws_require_auth(ws: WebSocket) -> _CtxToken | _WsAuthFailed:
    """Authenticate a WebSocket connection and set the user ContextVar.

    Must be called **before** ``ws.accept()`` so the server can reject
    unauthenticated upgrades cleanly.

    Returns a ContextVar reset token on success, or ``ws_auth_failed``
    on failure (the WebSocket is already closed — the caller should
    ``return`` immediately).

    Usage::

        user_token = await ws_require_auth(ws)
        if user_token is ws_auth_failed:
            return
        await ws.accept()
        try:
            ...
        finally:
            reset_current_user(user_token)
    """
    from aimtutor.multi_user.context import set_current_user, user_from_token_payload
    from aimtutor.multi_user.paths import local_admin_user
    from aimtutor.services.auth import AUTH_ENABLED, decode_token

    if clerk_is_enabled():
        token = ws.query_params.get("token")
        claims = await verify_clerk_token(token) if token else None
        if not claims:
            await ws.close(code=4001)
            return ws_auth_failed
        return set_current_user(user_from_token_payload(clerk_token_payload(claims)))

    if not AUTH_ENABLED:
        return set_current_user(local_admin_user())

    token = ws.query_params.get("token") or ws.cookies.get("dt_token")
    payload = decode_token(token) if token else None
    if not payload:
        await ws.close(code=4001)
        return ws_auth_failed

    blocked = _account_status_error(payload.user_id)
    if blocked:
        await ws.close(code=4003, reason=blocked[:123])
        return ws_auth_failed

    return set_current_user(user_from_token_payload(payload))


async def require_admin(
    payload: TokenPayload | None = Depends(require_auth),
) -> TokenPayload:
    """
    FastAPI dependency that requires the caller to be an admin.

    Raises HTTP 403 if the authenticated user is not an admin.
    When AUTH_ENABLED=false, all requests are treated as admin.
    """
    if not clerk_is_enabled() and not AUTH_ENABLED:
        from aimtutor.services.auth import TokenPayload as TP

        return TP(username="local", role="admin", user_id="local-admin")

    if payload is None or payload.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return payload


def _resolved_admin_role(user_id: str | None) -> str | None:
    if not user_id:
        return None
    from aimtutor.multi_user.identity import get_user_by_id

    result = get_user_by_id(user_id)
    if result is None:
        return None
    record = result[1]
    admin_role = record.get("admin_role")
    if admin_role:
        return str(admin_role)
    if str(record.get("role") or "") == "admin":
        return "admin"
    return None


def require_admin_role(*allowed_roles: str):
    """FastAPI dependency factory — checks ``admin_role`` for SaaS team roles."""

    async def _dep(payload: TokenPayload | None = Depends(require_auth)) -> TokenPayload:
        from aimtutor.multi_user.context import get_current_user
        from aimtutor.multi_user.identity import get_user_by_id

        if not clerk_is_enabled() and not AUTH_ENABLED:
            from aimtutor.services.auth import TokenPayload as TP

            return TP(username="local", role="admin", user_id="local-admin")

        user = get_current_user()
        if user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
        if not allowed_roles:
            if payload is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin access required",
                )
            return payload
        result = get_user_by_id(user.id)
        admin_role = (result[1].get("admin_role") if result else None) or "admin"
        if admin_role == "super_admin" or admin_role in allowed_roles:
            if payload is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin access required",
                )
            return payload
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Insufficient role. Required: {list(allowed_roles)}",
        )

    return _dep


require_super_admin = require_admin_role("super_admin")
require_finance_admin = require_admin_role("super_admin", "finance_admin")
require_support_agent = require_admin_role("super_admin", "admin", "support_agent")
require_ai_safety = require_admin_role("super_admin", "admin", "ai_safety_admin")
require_tutor_manager = require_admin_role("super_admin", "admin", "tutor_manager")
require_users_read = require_admin_role(
    "super_admin",
    "admin",
    "support_agent",
    "ai_safety_admin",
    "tutor_manager",
)
require_user_control = require_admin_role("super_admin", "admin", "support_agent")
require_conversations = require_admin_role(
    "super_admin",
    "admin",
    "support_agent",
    "ai_safety_admin",
)


# ---------------------------------------------------------------------------
# Public endpoints (no auth required)
# ---------------------------------------------------------------------------


def _auth_status_admin_role(user_id: str | None, role: str | None) -> str | None:
    if role != "admin":
        return None
    return _resolved_admin_role(user_id)


@router.get("/status", response_model=AuthStatusResponse)
async def auth_status(
    authorization: str | None = Header(default=None, alias="Authorization"),
    dt_token: str | None = Cookie(default=None),
) -> AuthStatusResponse:
    """Return whether auth is enabled and whether the current request is authenticated."""
    if clerk_is_enabled():
        token = _bearer_token_from_header(authorization)
        claims = await verify_clerk_token(token) if token else None
        payload = clerk_token_payload(claims) if claims else None
        return AuthStatusResponse(
            enabled=True,
            authenticated=payload is not None,
            user_id=payload.user_id if payload else None,
            username=payload.username if payload else None,
            role=payload.role if payload else None,
            is_admin=clerk_claims_is_admin(claims) if claims else False,
            admin_role=None,
        )

    if not AUTH_ENABLED:
        return AuthStatusResponse(
            enabled=False,
            authenticated=True,
            user_id="local-admin",
            username="local",
            role="admin",
            is_admin=True,
            admin_role="super_admin",
        )

    token = _extract_token(authorization, dt_token)
    payload = decode_token(token) if token else None
    return AuthStatusResponse(
        enabled=True,
        authenticated=payload is not None,
        user_id=payload.user_id if payload else None,
        username=payload.username if payload else None,
        role=payload.role if payload else None,
        is_admin=payload.role == "admin" if payload else False,
        admin_role=_auth_status_admin_role(
            payload.user_id if payload else None,
            payload.role if payload else None,
        ),
    )


@router.post("/login")
async def login(body: LoginRequest, response: Response) -> dict:
    """Validate credentials and set a JWT cookie."""
    if clerk_is_enabled():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clerk auth is enabled. Use /sign-in.",
        )

    if not AUTH_ENABLED:
        return {"ok": True, "message": "Auth is disabled — no login required."}

    if POCKETBASE_ENABLED:
        # PocketBase mode: email = username field for backwards-compat with the
        # existing LoginRequest schema; users can pass their email as "username".
        pb_result = authenticate_pb(body.username, body.password)
        if not pb_result:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
            )
        payload, pb_token = pb_result
        response.set_cookie(
            key=_COOKIE_NAME,
            value=pb_token,
            httponly=True,
            samesite=_SAMESITE,
            max_age=_COOKIE_MAX_AGE,
            secure=_SECURE,
        )
        logger.info(f"User '{payload.username}' logged in via PocketBase (role={payload.role!r})")
        return {
            "ok": True,
            "user_id": payload.user_id,
            "username": payload.username,
            "role": payload.role,
            "is_admin": payload.role == "admin",
        }

    # Standard JWT + bcrypt mode
    result = authenticate(body.username, body.password)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    token = create_token(result.username, result.role, result.user_id)
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite=_SAMESITE,
        max_age=_COOKIE_MAX_AGE,
        secure=_SECURE,
    )

    logger.info(f"User '{result.username}' logged in (role={result.role!r})")
    return {
        "ok": True,
        "user_id": result.user_id,
        "username": result.username,
        "role": result.role,
        "is_admin": result.role == "admin",
    }


@router.post("/logout")
async def logout(response: Response) -> dict:
    """Clear the JWT cookie."""
    response.delete_cookie(key=_COOKIE_NAME, samesite=_SAMESITE)
    return {"ok": True}


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, response: Response) -> dict:
    """
    Bootstrap-only registration.

    Public endpoint that creates the *first* admin account when the user store
    is empty. Once an admin exists, this endpoint is closed; further accounts
    must be created by an admin via ``POST /api/v1/auth/users``.

    Only available when AUTH_ENABLED=true.
    """
    if clerk_is_enabled():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Clerk auth is enabled. Use /sign-up.",
        )

    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Auth is disabled — registration is not available.",
        )

    if POCKETBASE_ENABLED:
        # PocketBase deployments are documented as single-user. Keep registration
        # closed and require admins to provision users in the PocketBase admin UI.
        if not is_first_user():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Self-registration is closed. Ask an administrator to create your account.",
            )
        result = register_pb(username=body.username, email=body.username, password=body.password)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Registration failed — username or email may already be taken.",
            )
        logger.info(f"First user registered via PocketBase: '{body.username}'")
        return {
            "ok": True,
            "user_id": result.get("id", ""),
            "username": body.username,
            "role": "user",
            "is_first_user": True,
            "is_admin": False,
        }

    # Standard mode — only allowed before the first admin exists.
    if not is_first_user():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-registration is closed. Ask an administrator to create your account.",
        )

    existing = {u["username"] for u in list_users()}
    if body.username in existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )

    add_user(body.username, body.password)
    user_id = ""
    role = "user"
    for item in list_users():
        if item.get("username") == body.username:
            user_id = str(item.get("id") or "")
            role = str(item.get("role") or "user")
            break
    token = create_token(body.username, role, user_id)
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite=_SAMESITE,
        max_age=_COOKIE_MAX_AGE,
        secure=_SECURE,
    )
    logger.info(f"First user (admin) registered: '{body.username}'")
    return {
        "ok": True,
        "user_id": user_id,
        "username": body.username,
        "role": role,
        "is_first_user": True,
        "is_admin": role == "admin",
    }


@router.get("/is_first_user")
async def check_is_first_user() -> dict:
    """Return whether the user store is empty (used by the register UI)."""
    return {"is_first_user": is_first_user() if AUTH_ENABLED else False}


# ---------------------------------------------------------------------------
# Admin-only endpoints
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[UserInfo])
async def get_users(_: TokenPayload = Depends(require_users_read)) -> list[UserInfo]:
    """List all registered users. Requires admin role."""
    return [UserInfo(**u) for u in list_users()]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    body: RegisterRequest,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Admin-only: create a new user account.

    Replaces the public ``/register`` flow once the first admin exists. The
    new account is always created with role=``user``; admins can promote
    later via ``PUT /users/{username}/role``.
    """
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Auth is disabled — user creation is not available.",
        )

    if POCKETBASE_ENABLED:
        result = register_pb(username=body.username, email=body.username, password=body.password)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Failed to create user — username may already be taken.",
            )
        logger.info(
            f"Admin '{current.username if current else 'local'}' created PocketBase user "
            f"'{body.username}'"
        )
        return {
            "ok": True,
            "user_id": result.get("id", ""),
            "username": body.username,
            "role": "user",
            "is_admin": False,
        }

    existing = {u["username"] for u in list_users()}
    if body.username in existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )

    add_user(body.username, body.password)
    user_id = ""
    role = "user"
    for item in list_users():
        if item.get("username") == body.username:
            user_id = str(item.get("id") or "")
            role = str(item.get("role") or "user")
            break
    logger.info(
        f"Admin '{current.username if current else 'local'}' created user '{body.username}' "
        f"(role={role!r})"
    )
    return {
        "ok": True,
        "user_id": user_id,
        "username": body.username,
        "role": role,
        "is_admin": role == "admin",
    }


@router.delete("/users/{username}", status_code=status.HTTP_200_OK)
async def remove_user(
    username: str,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Delete a user. Admins cannot delete their own account."""
    if current and username == current.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    removed = delete_user(username)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    logger.info(f"Admin '{current.username if current else 'local'}' deleted user '{username}'")
    return {"ok": True}


@router.put("/users/{username}/role", status_code=status.HTTP_200_OK)
async def update_user_role(
    username: str,
    body: SetRoleRequest,
    current: TokenPayload = Depends(require_admin),
) -> dict:
    """Change a user's role. Admins cannot change their own role."""
    if current and username == current.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    updated = set_role(username, body.role)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    logger.info(
        f"Admin '{current.username if current else 'local'}' set '{username}' role to {body.role!r}"
    )
    return {"ok": True, "username": username, "role": body.role}


@router.post("/users/{user_id}/suspend", status_code=status.HTTP_200_OK)
async def suspend_registered_user(
    user_id: str,
    body: SuspendRequest,
    _: TokenPayload = Depends(require_user_control),
) -> dict:
    """Suspend a user account by id. Requires admin role."""
    updated = suspend_user(user_id, body.reason)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    log_admin_action(
        "suspend_user",
        target_user_id=user_id,
        summary={"reason": body.reason},
    )
    return {"ok": True}


@router.post("/users/{user_id}/unsuspend", status_code=status.HTTP_200_OK)
async def unsuspend_registered_user(
    user_id: str,
    _: TokenPayload = Depends(require_user_control),
) -> dict:
    """Unsuspend a user account by id. Requires admin role."""
    updated = unsuspend_user(user_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found or user is banned",
        )
    log_admin_action("unsuspend_user", target_user_id=user_id, summary={})
    return {"ok": True}


@router.post("/users/{user_id}/ban", status_code=status.HTTP_200_OK)
async def ban_registered_user(
    user_id: str,
    body: BanRequest,
    _: TokenPayload = Depends(require_user_control),
) -> dict:
    """Ban a user account by id. Requires admin role."""
    updated = ban_user(user_id, body.reason)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    log_admin_action(
        "ban_user",
        target_user_id=user_id,
        summary={"reason": body.reason},
    )
    return {"ok": True}


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_200_OK)
async def reset_registered_user_password(
    user_id: str,
    body: ResetPasswordRequest,
    _: TokenPayload = Depends(require_user_control),
) -> dict:
    """Reset a user's password by id. Requires admin role."""
    hashed_pw = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    updated = reset_user_password(user_id, hashed_pw)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    log_admin_action("reset_password", target_user_id=user_id, summary={})
    return {"ok": True}


@router.post("/users/{user_id}/admin-role", status_code=status.HTTP_200_OK)
async def set_registered_user_admin_role(
    user_id: str,
    body: SetAdminRoleRequest,
    _: TokenPayload = Depends(require_super_admin),
) -> dict:
    """Set a user's SaaS admin role. Requires super_admin."""
    try:
        updated = set_admin_role(user_id, body.admin_role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    log_admin_action(
        "set_admin_role",
        target_user_id=user_id,
        summary={"admin_role": body.admin_role},
    )
    return {"ok": True, "user_id": user_id, "admin_role": body.admin_role}
