"""
Milagram — Authentication: middleware, JWT, login/register, permissions.
"""
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from backend.config import (
    app, logger, user_store, is_open_registration,
    JWT_SECRET, JWT_EXPIRY_DAYS, POSTS_DIR,
    _verify_api_key,
)
from backend.helpers import safe_resolve, _read_channel_meta

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# [MIDDLEWARE] Security headers
# ---------------------------------------------------------------------------

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# ---------------------------------------------------------------------------
# [AUTH] Authentication — JWT, permissions, login
# ---------------------------------------------------------------------------

# Paths that never require auth
PUBLIC_PATHS = {"/api/login", "/api/auth/check", "/api/logout", "/api/register", "/api/server/ping", "/api/server/info"}
PUBLIC_PREFIXES = ("/docs", "/openapi", "/redoc", "/api/public/", "/api/invite/")


def create_token(user_id: int, username: str = "") -> str:
    """Create a long-lived JWT token with user info"""
    now = datetime.now(timezone.utc).timestamp()
    payload = {
        "iat": now,
        "exp": now + (JWT_EXPIRY_DAYS * 86400),
        "sub": str(user_id),
        "username": username,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> Optional[dict]:
    """Decode and verify a JWT token. Returns payload dict or None"""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def verify_token(token: str) -> bool:
    """Verify a JWT token. Returns True if valid"""
    return decode_token(token) is not None


def _extract_token(request: Request) -> Optional[str]:
    """Extract JWT token from Authorization header or cookie"""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    # Fall back to cookie (used for media serving — avoids token in URL)
    return request.cookies.get("milagram_auth")


def get_current_user(request: Request) -> Optional[dict]:
    """Extract current user from request.

    Returns user dict or None. Does NOT raise — caller decides on 401/403.
    """
    token = _extract_token(request)
    if not token:
        return None

    payload = decode_token(token)
    if not payload:
        return None

    user_id_str = payload.get("sub")
    if not user_id_str:
        return None

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        return None

    return user_store.get_user_by_id(user_id)


def require_user(request: Request) -> dict:
    """Get current user or raise 401"""
    user = get_current_user(request)
    if not user:
        raise HTTPException(401, "Authentication required")
    return user


def check_channel_permission(
    channel_name: str, user: Optional[dict],
    required_role: str = "viewer",
) -> str:
    """Check user's permission on a channel.

    Checks membership and visibility.

    required_role: "viewer" | "editor" | "owner"
    Returns the user's actual role.
    Raises HTTPException(403) if insufficient.
    """
    if user and user.get("is_admin"):
        return "owner"

    role = user_store.get_user_role(channel_name, user["id"]) if user else None

    # Check channel visibility
    channel_dir = safe_resolve(POSTS_DIR, channel_name)
    meta = _read_channel_meta(channel_dir)
    visibility = meta.get("visibility", "private")

    if visibility == "public" and required_role == "viewer":
        # Public channels allow anonymous reading
        return role or "viewer"

    if not role:
        raise HTTPException(403, "You don't have access to this channel")

    role_levels = {"viewer": 0, "editor": 1, "owner": 2}
    if role_levels.get(role, 0) < role_levels.get(required_role, 0):
        raise HTTPException(403, f"Requires {required_role} role, you have {role}")

    return role



@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Allow public paths
    if path in PUBLIC_PATHS or any(path.startswith(p) for p in PUBLIC_PREFIXES):
        return await call_next(request)

    # Allow frontend static files (non-API, non-media)
    if not path.startswith("/api/") and not path.startswith("/posts/"):
        return await call_next(request)

    # Check JWT token
    token = _extract_token(request)
    if token and verify_token(token):
        return await call_next(request)

    # Check API key (header: X-API-Key or query: ?api_key=)
    api_key = request.headers.get("x-api-key") or request.query_params.get("api_key")
    if api_key and _verify_api_key(api_key):
        return await call_next(request)

    return JSONResponse(status_code=401, content={"detail": "Unauthorized"})


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Simple rate limiter for auth endpoints (per IP)
# ---------------------------------------------------------------------------

_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 300  # 5 minutes
_RATE_LIMIT_MAX = 10      # max attempts per window


def _check_rate_limit(ip: str):
    now = time.time()
    attempts = _login_attempts[ip]
    # Prune old attempts
    _login_attempts[ip] = [t for t in attempts if now - t < _RATE_LIMIT_WINDOW]
    if len(_login_attempts[ip]) >= _RATE_LIMIT_MAX:
        raise HTTPException(429, "Too many login attempts. Try again in a few minutes.")
    _login_attempts[ip].append(now)


class LoginRequest(BaseModel):
    password: str
    username: str


@app.post("/api/login")
async def login(body: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    if not body.username:
        raise HTTPException(400, "Username is required")

    user = user_store.verify_password(body.username, body.password)
    if not user:
        logger.warning("Failed login attempt for user '%s'", body.username)
        raise HTTPException(401, "Wrong username or password")

    logger.info("Successful login: %s (id=%d)", user["username"], user["id"])
    token = create_token(user["id"], user["username"])
    return {
        "token": token,
        "expires_in_days": JWT_EXPIRY_DAYS,
        "user": user,
    }


@app.post("/api/logout")
async def logout_endpoint():
    """Clear the auth cookie"""
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("milagram_auth")
    return resp



@app.get("/api/auth/check")
async def auth_check(request: Request):
    """Check if auth is enabled and if current token is valid"""
    token = _extract_token(request)
    authenticated = bool(token and verify_token(token))

    result = {
        "auth_required": True,
        "authenticated": authenticated,
        "multi_user": True,
        "open_registration": is_open_registration(),
    }

    if authenticated:
        user = get_current_user(request)
        if user:
            result["user"] = user

    return result


# ---------------------------------------------------------------------------
