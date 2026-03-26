"""
Milagram — Multi-user endpoints: users, members, invites, admin panel.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel

from backend.config import (
    app, logger, user_store, is_open_registration,
    POSTS_DIR, JWT_EXPIRY_DAYS, CHANNEL_RESERVED_NAMES,
    USERNAME_RE, MIN_PASSWORD_LENGTH, MAX_USERNAME_LENGTH,
    OPEN_REGISTRATION_DEFAULT,
)
from backend.auth import (
    create_token, require_user, get_current_user, check_channel_permission,
    _check_rate_limit,
)
from backend.helpers import (
    validate_channel_name, safe_resolve, read_post, _read_channel_meta,
)

# User management, members, invites, admin panel
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""

@app.post("/api/register")
async def register(body: RegisterRequest, request: Request):
    """Register a new user account"""
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    # Check if open registration is allowed (first user always allowed)
    if user_store.user_count() > 0 and not is_open_registration():
        raise HTTPException(403, "Registration is disabled. Ask an admin to create your account.")

    # Validate username
    if not USERNAME_RE.match(body.username):
        raise HTTPException(
            400,
            "Username must be 2-32 chars, start with a letter, "
            "contain only letters, digits, and underscores"
        )
    if body.username.lower() in CHANNEL_RESERVED_NAMES:
        raise HTTPException(400, f"Username '{body.username}' is reserved")

    # Validate password
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

    # First user becomes admin
    is_admin = user_store.user_count() == 0

    try:
        user = user_store.create_user(
            username=body.username,
            password=body.password,
            display_name=body.display_name or body.username,
            is_admin=is_admin,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))

    logger.info("Registered user: %s (admin=%s)", body.username, is_admin)
    return {
        "token": create_token(user["id"], user["username"]),
        "expires_in_days": JWT_EXPIRY_DAYS,
        "user": user,
    }

@app.get("/api/me")
async def get_me(request: Request):
    """Get current user info"""
    user = require_user(request)
    return user

@app.put("/api/me")
async def update_me(request: Request):
    """Update current user profile. Body: {display_name?, username?, password?}"""
    user = require_user(request)
    body = await request.json()

    display_name = body.get("display_name")
    username = body.get("username")
    password = body.get("password")

    if username is not None:
        if not USERNAME_RE.match(username):
            raise HTTPException(400, "Username must be 2-32 chars, start with letter, only letters/digits/_")
        if len(username) < 2:
            raise HTTPException(400, "Username too short")
    if password is not None and len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

    try:
        updated = user_store.update_user(
            user["id"],
            display_name=display_name,
            username=username,
            password=password,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))

    if not updated:
        raise HTTPException(404, "User not found")

    # If username changed, issue new token
    new_token = None
    if username and username != user.get("username"):
        new_token = create_token(user_id=updated["id"], username=username)

    return {"user": updated, "token": new_token}

@app.get("/api/users")
async def list_users(request: Request):
    """List all users (admin only)"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    return user_store.list_users()

# --- Channel member management ---

@app.get("/api/channels/{channel}/members")
async def get_channel_members(channel: str, request: Request):
    """List members of a channel"""
    user = require_user(request)
    validate_channel_name(channel)
    check_channel_permission(channel, user, "viewer")
    return user_store.get_channel_members(channel)

class AddMemberRequest(BaseModel):
    user_id: int
    role: str = "viewer"

@app.post("/api/channels/{channel}/members")
async def add_channel_member(channel: str, body: AddMemberRequest, request: Request):
    """Add or update a channel member (owner only)"""
    user = require_user(request)
    validate_channel_name(channel)
    check_channel_permission(channel, user, "owner")

    if body.role not in ("viewer", "editor", "owner"):
        raise HTTPException(400, "Role must be 'viewer', 'editor', or 'owner'")

    target = user_store.get_user_by_id(body.user_id)
    if not target:
        raise HTTPException(404, "User not found")

    user_store.add_channel_member(channel, body.user_id, body.role)
    return {"ok": True}

@app.delete("/api/channels/{channel}/members/{user_id}")
async def remove_channel_member(channel: str, user_id: int, request: Request):
    """Remove a member from a channel (owner only)"""
    user = require_user(request)
    validate_channel_name(channel)
    check_channel_permission(channel, user, "owner")
    user_store.remove_channel_member(channel, user_id)
    return {"ok": True}

# --- Invite system ---

class CreateInviteRequest(BaseModel):
    role: str = "viewer"
    max_uses: int = 1
    expires_in_days: Optional[int] = None

@app.post("/api/channels/{channel}/invite")
async def create_invite(channel: str, body: CreateInviteRequest, request: Request):
    """Create an invite link for a channel (owner only)"""
    user = require_user(request)
    validate_channel_name(channel)
    check_channel_permission(channel, user, "owner")

    if body.role not in ("viewer", "editor"):
        raise HTTPException(400, "Invite role must be 'viewer' or 'editor'")

    expires_at = None
    if body.expires_in_days:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)).isoformat()

    invite = user_store.create_invite(
        channel_name=channel,
        role=body.role,
        created_by=user["id"],
        expires_at=expires_at,
        max_uses=body.max_uses,
    )
    return invite

@app.get("/api/channels/{channel}/invites")
async def list_channel_invites(channel: str, request: Request):
    """List invites for a channel (owner only)"""
    user = require_user(request)
    validate_channel_name(channel)
    check_channel_permission(channel, user, "owner")
    return user_store.list_invites(channel)

@app.delete("/api/invites/{token}")
async def delete_invite(token: str, request: Request):
    """Delete an invite (owner of the channel only)"""
    user = require_user(request)
    invite = user_store.get_invite(token)
    if not invite:
        raise HTTPException(404, "Invite not found")
    check_channel_permission(invite["channel_name"], user, "owner")
    user_store.delete_invite(token)
    return {"ok": True}

@app.get("/api/invite/{token}")
async def get_invite_info(token: str):
    """Get invite info (public — for the accept page)"""
    invite = user_store.get_invite(token)
    if not invite:
        raise HTTPException(404, "Invite not found or expired")

    # Check if still valid
    if invite.get("expires_at"):
        try:
            exp = datetime.fromisoformat(invite["expires_at"])
            if datetime.now(timezone.utc) > exp:
                raise HTTPException(410, "Invite has expired")
        except ValueError:
            pass

    if invite["use_count"] >= invite["max_uses"]:
        raise HTTPException(410, "Invite has been used up")

    # Return limited info (no internal IDs)
    channel_dir = safe_resolve(POSTS_DIR, invite["channel_name"])
    channel_meta = _read_channel_meta(channel_dir)
    return {
        "channel_name": invite["channel_name"],
        "channel_display_name": channel_meta.get("display_name", invite["channel_name"]),
        "channel_emoji": channel_meta.get("emoji", ""),
        "role": invite["role"],
    }

class AcceptInviteRequest(BaseModel):
    username: str = ""
    password: str = ""
    display_name: str = ""

@app.post("/api/invite/{token}/accept")
async def accept_invite(token: str, body: AcceptInviteRequest, request: Request):
    """Accept an invite.

    If already logged in: just joins the channel.
    If not logged in: must provide username+password to register, then joins.
    """
    invite = user_store.get_invite(token)
    if not invite:
        raise HTTPException(404, "Invite not found or expired")

    # Try to get current user
    user = get_current_user(request)

    if not user:
        # Must register
        if not body.username or not body.password:
            raise HTTPException(400, "Username and password required to accept invite")

        if not USERNAME_RE.match(body.username):
            raise HTTPException(400, "Invalid username format")

        if len(body.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

        is_admin = user_store.user_count() == 0
        try:
            user = user_store.create_user(
                username=body.username,
                password=body.password,
                display_name=body.display_name or body.username,
                is_admin=is_admin,
            )
        except ValueError as e:
            raise HTTPException(409, str(e))

    # Use invite (checks expiry + max_uses, increments counter)
    if not user_store.use_invite(token):
        raise HTTPException(410, "Invite expired or exhausted")

    # Add user to channel
    user_store.add_channel_member(
        invite["channel_name"], user["id"], invite["role"],
    )

    logger.info(
        "User %s accepted invite to channel %s (role=%s)",
        user["username"], invite["channel_name"], invite["role"],
    )

    return {
        "token": create_token(user["id"], user["username"]),
        "expires_in_days": JWT_EXPIRY_DAYS,
        "user": user,
        "channel_name": invite["channel_name"],
    }

# --- Admin panel endpoints ---

@app.get("/api/admin/settings")
async def get_admin_settings(request: Request):
    """Get app settings (admin only)"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    settings = user_store.get_settings()
    return settings

class UpdateSettingsRequest(BaseModel):
    open_registration: Optional[bool] = None

@app.put("/api/admin/settings")
async def update_admin_settings(body: UpdateSettingsRequest, request: Request):
    """Update app settings (admin only)"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    settings = user_store.get_settings()
    if body.open_registration is not None:
        settings["open_registration"] = body.open_registration
    user_store.save_settings(settings)
    logger.info("Admin %s updated settings: %s", user["username"], settings)
    return settings

class AdminCreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""
    is_admin: bool = False

@app.post("/api/admin/users")
async def admin_create_user(body: AdminCreateUserRequest, request: Request):
    """Create a user (admin only)"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")

    if not USERNAME_RE.match(body.username):
        raise HTTPException(400, "Invalid username format")
    if body.username.lower() in CHANNEL_RESERVED_NAMES:
        raise HTTPException(400, f"Username '{body.username}' is reserved")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

    try:
        new_user = user_store.create_user(
            username=body.username,
            password=body.password,
            display_name=body.display_name or body.username,
            is_admin=body.is_admin,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))

    logger.info("Admin %s created user %s", user["username"], body.username)
    return new_user

@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: int, request: Request):
    """Delete a user (admin only). Cannot delete yourself"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")
    if user["id"] == user_id:
        raise HTTPException(400, "Cannot delete yourself")
    target = user_store.get_user_by_id(user_id)
    if not target:
        raise HTTPException(404, "User not found")
    user_store.delete_user(user_id)
    logger.info("Admin %s deleted user %s (id=%d)", user["username"], target["username"], user_id)
    return {"ok": True}

@app.get("/api/admin/stats")
async def admin_stats(request: Request):
    """Get system statistics (admin only)"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")

    # Count channels and posts
    channel_count = 0
    post_count = 0
    total_size = 0
    for entry in POSTS_DIR.iterdir():
        if entry.is_dir() and not entry.name.startswith((".", "_")):
            channel_count += 1
            for post_dir in entry.iterdir():
                if post_dir.is_dir() and not post_dir.name.startswith("."):
                    post_count += 1
                    for f in post_dir.iterdir():
                        if f.is_file():
                            total_size += f.stat().st_size

    return {
        "users": user_store.user_count(),
        "channels": channel_count,
        "posts": post_count,
        "storage_bytes": total_size,
    }

# --- Public channel read (no auth) ---

@app.get("/api/public/{channel}/posts")
async def get_public_channel_posts(channel: str):
    """Read posts from a public channel (no auth required)"""
    validate_channel_name(channel)
    channel_dir = safe_resolve(POSTS_DIR, channel)
    if not channel_dir.exists():
        raise HTTPException(404, f"Channel '{channel}' not found")

    meta = _read_channel_meta(channel_dir)
    if meta.get("visibility") != "public":
        raise HTTPException(404, "Channel not found")

    posts = []
    for folder in sorted(channel_dir.iterdir()):
        if folder.is_dir() and not folder.name.startswith("."):
            post = read_post(folder, channel)
            # Filter hidden posts for public view
            if not post.get("hidden"):
                posts.append(post)
    return posts




# ---------------------------------------------------------------------------
