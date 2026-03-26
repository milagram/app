"""
Milagram — All API routes: channels, posts, templates, API keys, backup, import, media.
"""
import json
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.config import (
    app, logger, user_store, is_open_registration, POSTS_DIR, FRONTEND_DIR,
    MEDIA_EXTENSIONS, BACKUP_DIR,
    MAX_FILE_SIZE, MAX_FILES_PER_POST, MAX_TITLE_LENGTH, MAX_TEXT_LENGTH,
    _load_api_keys, _save_api_keys,
)
from backend.auth import (
    require_user, get_current_user, check_channel_permission, create_token,
)
from backend.helpers import (
    validate_path_component, safe_resolve, sanitize_filename,
    validate_file_extension, validate_channel_name, get_channel_dir,
    make_basename, generate_md, read_post, _read_channel_meta,
    _filter_posts_for_user, ensure_posts_dir,
)

# ---------------------------------------------------------------------------
# [SERVER] Ping & info (public, no auth)
# Modeled after Immich API: https://immich.app/docs/api
# ---------------------------------------------------------------------------

@app.get("/api/server/ping")
async def server_ping():
    """Liveness check — returns pong if server is running"""
    return {"res": "pong"}


@app.get("/api/server/info")
async def server_info():
    """Server info for clients — version, auth config, registration status"""
    return {
        "name": "Milagram",
        "version": app.version,
        "auth_required": True,
        "registration_open": is_open_registration(),
    }


# [CHANNELS] Channel CRUD
# ---------------------------------------------------------------------------

@app.get("/api/channels")
async def get_channels(request: Request):
    """List channels. Multi-user: filtered by membership + public"""
    ensure_posts_dir()
    user = get_current_user(request)

    # In multi-user mode, get user's channel memberships
    user_channels = set()
    if user:
        user_channels = set(user_store.get_user_channels(user["id"]))

    channels = []
    for d in sorted(POSTS_DIR.iterdir()):
        if d.is_dir() and not d.name.startswith(".") and not d.name.startswith("_"):
            meta = {"name": d.name}
            meta_file = d / "_channel.json"
            if meta_file.exists():
                try:
                    data = json.loads(meta_file.read_text(encoding="utf-8"))
                    meta.update(data)
                except (json.JSONDecodeError, OSError):
                    pass

            # Multi-user filtering
            if user:
                visibility = meta.get("visibility", "private")
                is_member = d.name in user_channels
                is_admin = user.get("is_admin", False)
                if not is_member and not is_admin and visibility != "public":
                    continue

            # Count posts
            meta["post_count"] = sum(
                1 for p in d.iterdir()
                if p.is_dir() and not p.name.startswith(".")
            )

            # Add user's role if multi-user
            if user:
                role = user_store.get_user_role(d.name, user["id"])
                if role:
                    meta["my_role"] = role
                elif user.get("is_admin"):
                    meta["my_role"] = "owner"

            channels.append(meta)
    return channels


class ChannelCreateRequest(BaseModel):
    name: str
    display_name: str = ""
    description: str = ""
    emoji: str = ""
    visibility: str = "private"  # "public" | "private"


@app.post("/api/channels")
async def create_channel(body: ChannelCreateRequest, request: Request):
    """Create a new channel"""
    ensure_posts_dir()
    name = validate_channel_name(body.name)
    channel_dir = safe_resolve(POSTS_DIR, name)

    if channel_dir.exists():
        raise HTTPException(409, f"Channel '{name}' already exists")

    if body.visibility not in ("public", "private"):
        raise HTTPException(400, "Visibility must be 'public' or 'private'")

    channel_dir.mkdir(parents=True)

    meta = {
        "name": name,
        "display_name": body.display_name,
        "description": body.description,
        "emoji": body.emoji,
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(),
    }

    meta["visibility"] = body.visibility

    (channel_dir / "_channel.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # In multi-user mode, creator becomes owner
    user = get_current_user(request)
    if user:
        user_store.add_channel_member(name, user["id"], "owner")

    logger.info("Created channel: %s", name)
    meta["post_count"] = 0
    return meta


@app.put("/api/channels/{channel}")
async def update_channel(channel: str, body: ChannelCreateRequest, request: Request):
    """Update channel metadata (description, emoji, visibility)"""
    validate_channel_name(channel)
    channel_dir = safe_resolve(POSTS_DIR, channel)
    if not channel_dir.exists():
        raise HTTPException(404, f"Channel '{channel}' not found")

    # Permission check
    user = require_user(request)
    check_channel_permission(channel, user, "owner")

    meta = {"name": channel}
    meta_file = channel_dir / "_channel.json"
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    meta["display_name"] = body.display_name
    meta["description"] = body.description
    meta["emoji"] = body.emoji

    if body.visibility not in ("public", "private"):
        raise HTTPException(400, "Visibility must be 'public' or 'private'")
    meta["visibility"] = body.visibility

    meta_file.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info("Updated channel: %s", channel)
    return meta


@app.delete("/api/channels/{channel}")
async def delete_channel(channel: str, request: Request):
    """Delete a channel and all its posts"""
    validate_channel_name(channel)
    channel_dir = safe_resolve(POSTS_DIR, channel)
    if not channel_dir.exists():
        raise HTTPException(404, f"Channel '{channel}' not found")

    # Permission check
    user = require_user(request)
    check_channel_permission(channel, user, "owner")

    shutil.rmtree(channel_dir)
    logger.info("Deleted channel: %s", channel)
    return {"ok": True}


# ---------------------------------------------------------------------------
# [TEMPLATES] Quick-input templates
# ---------------------------------------------------------------------------

@app.get("/api/channels/{channel}/templates")
async def get_templates(channel: str, request: Request):
    """Get quick-input templates for a channel"""
    channel_dir = get_channel_dir(channel)
    tpl_file = channel_dir / "_templates.json"
    if tpl_file.exists():
        try:
            return json.loads(tpl_file.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


@app.put("/api/channels/{channel}/templates")
async def save_templates(channel: str, request: Request):
    """Save quick-input templates for a channel. Body: string[]"""
    channel_dir = get_channel_dir(channel)
    body = await request.json()
    if not isinstance(body, list):
        raise HTTPException(400, "Body must be an array of strings")
    # Limit: max 50 templates, max 200 chars each
    templates = [str(t)[:200] for t in body[:50]]
    tpl_file = channel_dir / "_templates.json"
    tpl_file.write_text(json.dumps(templates, ensure_ascii=False, indent=2), encoding="utf-8")
    return templates


# ---------------------------------------------------------------------------
# [API-KEYS] Management
# ---------------------------------------------------------------------------

@app.get("/api/admin/api-keys")
async def list_api_keys(request: Request):
    """List all API keys (key value masked)"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    keys = _load_api_keys()
    # Mask keys for display
    return [
        {**k, "key": k["key"][:8] + "..." + k["key"][-4:]}
        for k in keys
    ]


@app.post("/api/admin/api-keys")
async def create_api_key(request: Request):
    """Create a new API key. Body: {"name": "My integration"}"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    body = await request.json()
    name = body.get("name", "API Key")

    key_value = "sk-" + secrets.token_hex(24)
    new_key = {
        "key": key_value,
        "name": str(name)[:100],
        "created_at": datetime.now().isoformat(),
        "active": True,
    }
    keys = _load_api_keys()
    if len(keys) >= 20:
        raise HTTPException(400, "Max 20 API keys")
    keys.append(new_key)
    _save_api_keys(keys)
    logger.info("API key created: %s", name)
    # Return full key only on creation
    return new_key


@app.delete("/api/admin/api-keys/{key_prefix}")
async def delete_api_key(key_prefix: str, request: Request):
    """Delete API key by first 8 chars"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    keys = _load_api_keys()
    new_keys = [k for k in keys if not k["key"].startswith(key_prefix)]
    if len(new_keys) == len(keys):
        raise HTTPException(404, "Key not found")
    _save_api_keys(new_keys)
    return {"ok": True}


# ---------------------------------------------------------------------------
# [EXTERNAL-API] Posts, backup via API keys
# ---------------------------------------------------------------------------

@app.post("/api/ext/posts/{channel}")
async def ext_create_post(
    channel: str,
    request: Request,
    title: str = Form(""),
    text: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    """Create a post via external API. Works with API key or JWT"""
    # Permission check: require authenticated user with editor role
    user = get_current_user(request)
    if user:
        check_channel_permission(channel, user, "editor")

    channel_dir = get_channel_dir(channel)

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    title = title.replace("\r\n", "\n").replace("\r", "\n")

    if len(files) > MAX_FILES_PER_POST:
        raise HTTPException(400, f"Too many files (max {MAX_FILES_PER_POST})")

    dt = datetime.now()
    basename = make_basename(dt, title)
    folder = channel_dir / basename
    if folder.exists():
        basename += f"_{int(dt.timestamp()) % 10000}"
        folder = channel_dir / basename
    folder.mkdir(parents=True)

    file_names = []
    for f in files:
        safe_name = sanitize_filename(f.filename)
        validate_file_extension(safe_name)
        dest = safe_resolve(folder, safe_name)
        size = 0
        with open(dest, "wb") as out:
            while chunk := await f.read(256 * 1024):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(400, f"File '{safe_name}' too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")
                out.write(chunk)
        file_names.append(safe_name)

    tz = datetime.now(timezone.utc).astimezone()
    md = generate_md(basename, title, text, file_names, tz.isoformat())
    (folder / f"{basename}.md").write_text(md, encoding="utf-8")

    logger.info("External API: created post %s in %s", basename, channel)
    return read_post(folder, channel)


@app.get("/api/ext/posts/{channel}")
async def ext_list_posts(
    channel: str,
    request: Request,
    limit: int = 20,
):
    """List recent posts via external API"""
    # Permission check
    user = get_current_user(request)
    if user:
        check_channel_permission(channel, user, "viewer")

    channel_dir = get_channel_dir(channel)

    folders = sorted(
        (f for f in channel_dir.iterdir() if f.is_dir() and not f.name.startswith(".")),
        key=lambda f: f.name,
    )

    if limit > 0:
        folders = folders[-limit:]

    return [read_post(f, channel) for f in folders]


@app.post("/api/ext/backup")
async def ext_trigger_backup(request: Request, max_size_mb: int = 200):
    """Trigger backup via external API. Returns list of created files"""
    # Permission check: admin only
    user = get_current_user(request)
    if user and not user.get("is_admin"):
        raise HTTPException(403, "Admin access required")

    if max_size_mb < 10 or max_size_mb > 1000:
        raise HTTPException(400, "max_size_mb must be between 10 and 1000")

    # Reuse the admin backup logic
    import zipfile

    BACKUP_DIR.mkdir(exist_ok=True)
    for f in BACKUP_DIR.glob("*.zip"):
        f.unlink()

    max_bytes = max_size_mb * 1024 * 1024
    part = 1
    current_size = 0
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = BACKUP_DIR / f"backup_{timestamp}_part{part}.zip"
    zf = zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED)
    files_added = 0
    parts = [zip_path.name]

    for item in sorted(POSTS_DIR.rglob("*")):
        if not item.is_file() or str(item.relative_to(POSTS_DIR)).startswith(".backups"):
            continue
        file_size = item.stat().st_size
        if current_size + file_size > max_bytes and current_size > 0:
            zf.close()
            part += 1
            zip_path = BACKUP_DIR / f"backup_{timestamp}_part{part}.zip"
            zf = zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED)
            current_size = 0
            parts.append(zip_path.name)
        zf.write(item, str(item.relative_to(POSTS_DIR)))
        current_size += file_size
        files_added += 1
    zf.close()

    logger.info("External backup: %d files in %d parts", files_added, len(parts))
    return {"ok": True, "parts": parts, "files": files_added}


# ---------------------------------------------------------------------------
# [BACKUP] Backup & export
# ---------------------------------------------------------------------------

@app.post("/api/admin/backup")
async def create_backup(request: Request, max_size_mb: int = Form(200)):
    """Archive all data into ZIP files, each ≤ max_size_mb"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    import zipfile

    BACKUP_DIR.mkdir(exist_ok=True)
    # Clean old backups
    for f in BACKUP_DIR.glob("*.zip"):
        f.unlink()

    max_bytes = max_size_mb * 1024 * 1024
    part = 1
    current_size = 0
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = BACKUP_DIR / f"backup_{timestamp}_part{part}.zip"
    zf = zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED)

    files_added = 0
    parts_created = [zip_path.name]

    for item in sorted(POSTS_DIR.rglob("*")):
        if not item.is_file():
            continue
        # Skip backup dir itself
        rel = item.relative_to(POSTS_DIR)
        if str(rel).startswith(".backups"):
            continue

        file_size = item.stat().st_size

        # Start new part if current would exceed limit
        if current_size + file_size > max_bytes and current_size > 0:
            zf.close()
            part += 1
            zip_path = BACKUP_DIR / f"backup_{timestamp}_part{part}.zip"
            zf = zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED)
            current_size = 0
            parts_created.append(zip_path.name)

        zf.write(item, str(rel))
        current_size += file_size
        files_added += 1

    zf.close()

    logger.info("Backup created: %d files in %d parts", files_added, len(parts_created))
    return {
        "ok": True,
        "parts": parts_created,
        "files": files_added,
        "path": str(BACKUP_DIR),
    }


@app.get("/api/admin/backup/list")
async def list_backups(request: Request):
    """List available backup files"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    if not BACKUP_DIR.exists():
        return []

    result = []
    for f in sorted(BACKUP_DIR.glob("*.zip")):
        result.append({
            "name": f.name,
            "size": f.stat().st_size,
        })
    return result


@app.get("/api/admin/backup/download/{filename}")
async def download_backup(filename: str, request: Request):
    """Download a backup ZIP file"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    validate_path_component(filename, "filename")
    file_path = safe_resolve(BACKUP_DIR, filename)
    if not file_path.exists():
        raise HTTPException(404, "Backup not found")
    return FileResponse(file_path, filename=filename, media_type="application/zip")


# ---------------------------------------------------------------------------
# [TELEGRAM-IMPORT] Import from Telegram
# ---------------------------------------------------------------------------

@app.post("/api/import/telegram")
async def import_telegram_export(
    request: Request,
    channel: str = Form(...),
    file: UploadFile = File(...),
):
    """Import Telegram JSON+media export (ZIP file) into a channel"""
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    validate_channel_name(channel)

    import zipfile
    import tempfile

    # Save uploaded ZIP
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        zip_path = tmp_path / "export.zip"

        size = 0
        with open(zip_path, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > 500 * 1024 * 1024:  # 500MB limit
                    raise HTTPException(400, "ZIP too large (max 500MB)")
                out.write(chunk)

        # Extract ZIP (safe: validate every path against traversal)
        try:
            extract_dir = tmp_path / "extracted"
            extract_dir.mkdir()
            with zipfile.ZipFile(zip_path, "r") as zf:
                for member in zf.infolist():
                    target = (extract_dir / member.filename).resolve()
                    if not str(target).startswith(str(extract_dir.resolve())):
                        raise HTTPException(400, f"Path traversal detected in ZIP: {member.filename}")
                    if member.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with zf.open(member) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)
        except zipfile.BadZipFile:
            raise HTTPException(400, "Invalid ZIP file")

        # Find result.json
        extracted = tmp_path / "extracted"
        json_file = None
        for f in extracted.rglob("result.json"):
            json_file = f
            break

        if not json_file:
            raise HTTPException(400, "result.json not found in ZIP. Export from Telegram Desktop as JSON format.")

        # Run import
        sys_path = Path(__file__).parent.parent / "tools" / "import_telegram.py"
        if not sys_path.exists():
            raise HTTPException(500, "Import script not found")

        # Import inline to avoid subprocess
        import importlib.util
        spec = importlib.util.spec_from_file_location("import_telegram", str(sys_path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        mod.import_telegram(json_file, channel, POSTS_DIR)

    logger.info("Telegram import completed for channel: %s", channel)
    return {"ok": True, "channel": channel}


# ---------------------------------------------------------------------------
# [POSTS] Post CRUD
# ---------------------------------------------------------------------------

@app.get("/api/channels/{channel}/posts")
async def get_channel_posts(
    channel: str,
    request: Request,
    limit: Optional[int] = None,
    before: Optional[str] = None,
    search: Optional[str] = None,
):
    """Get posts in a channel.

    - limit=10: return last ~10 posts, completing partial days
    - before=basename: cursor pagination
    - search=query: full-text search across ALL posts (title + text), ignores limit/before
    """
    channel_dir = get_channel_dir(channel)

    user = get_current_user(request)
    check_channel_permission(channel, user, "viewer")

    folders = sorted(
        (f for f in channel_dir.iterdir() if f.is_dir() and not f.name.startswith(".")),
        key=lambda f: f.name,
    )

    # Full-text search: scan all posts, return matches (no pagination)
    if search and search.strip():
        query = search.strip().lower()
        posts = []
        for f in folders:
            post = read_post(f, channel)
            haystack = ((post.get("title") or "") + " " + (post.get("text") or "")).lower()
            if query in haystack:
                posts.append(post)
        return _filter_posts_for_user(posts, user, channel)

    # Cursor: only folders before this basename
    if before:
        folders = [f for f in folders if f.name < before]

    # Limit: take last N, then extend to include the full earliest day
    if limit and limit > 0 and len(folders) > limit:
        cutoff = folders[-limit]
        cutoff_day = cutoff.name[:8]
        folders = [f for f in folders if f.name[:8] >= cutoff_day]

    posts = [read_post(f, channel) for f in folders]
    return _filter_posts_for_user(posts, user, channel)


@app.get("/api/channels/{channel}/posts/{basename}")
async def get_single_post(channel: str, basename: str, request: Request):
    """Get a single post by basename. Respects channel permissions"""
    validate_channel_name(channel)
    validate_path_component(basename, "basename")
    channel_dir = safe_resolve(POSTS_DIR, channel)

    user = get_current_user(request)
    check_channel_permission(channel, user, "viewer")

    folder = safe_resolve(channel_dir, basename)
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(404, f"Post '{basename}' not found")

    post = read_post(folder, channel)
    filtered = _filter_posts_for_user([post], user, channel)
    if not filtered:
        raise HTTPException(404, f"Post '{basename}' not found")
    return filtered[0]


@app.post("/api/channels/{channel}/posts")
async def create_channel_post(
    channel: str,
    request: Request,
    title: str = Form(""),
    text: str = Form(""),
    date: Optional[str] = Form(None),
    hidden: bool = Form(False),
    files: list[UploadFile] = File(default=[]),
):
    channel_dir = get_channel_dir(channel)

    # Permission check
    user = require_user(request)
    check_channel_permission(channel, user, "editor")
    author = user["username"]

    # Input validation
    if len(title) > MAX_TITLE_LENGTH:
        raise HTTPException(400, f"Title too long (max {MAX_TITLE_LENGTH})")
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(400, f"Text too long (max {MAX_TEXT_LENGTH})")
    if len(files) > MAX_FILES_PER_POST:
        raise HTTPException(400, f"Too many files (max {MAX_FILES_PER_POST})")

    if date:
        try:
            dt = datetime.fromisoformat(date)
        except ValueError:
            dt = datetime.now()
    else:
        dt = datetime.now()

    basename = make_basename(dt, title)
    folder = channel_dir / basename

    # Avoid collision
    if folder.exists():
        basename += f"_{int(datetime.now().timestamp()) % 10000}"
        folder = channel_dir / basename

    folder.mkdir(parents=True)

    # Save media files (streaming to avoid loading entire file in memory)
    file_names = []
    for f in files:
        safe_name = sanitize_filename(f.filename)
        validate_file_extension(safe_name)
        dest = safe_resolve(folder, safe_name)
        size = 0
        with open(dest, "wb") as out:
            while chunk := await f.read(256 * 1024):  # 256KB chunks
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(400, f"File '{safe_name}' too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")
                out.write(chunk)
        file_names.append(safe_name)

    # Generate .md
    tz = datetime.now(timezone.utc).astimezone()
    created_at = tz.isoformat()
    md = generate_md(basename, title, text, file_names, created_at, author=author, hidden=hidden)
    (folder / f"{basename}.md").write_text(md, encoding="utf-8")

    logger.info("Created post in %s: %s (author=%s)", channel, basename, author)
    return read_post(folder, channel)


@app.put("/api/channels/{channel}/posts/{old_basename}")
async def update_channel_post(
    channel: str,
    old_basename: str,
    request: Request,
    title: str = Form(""),
    text: str = Form(""),
    basename: str = Form(""),
    retained_files: str = Form("[]"),
    hidden: bool = Form(False),
    files: list[UploadFile] = File(default=[]),
):
    channel_dir = get_channel_dir(channel)
    validate_path_component(old_basename, "basename")

    # Permission check
    user = require_user(request)
    role = check_channel_permission(channel, user, "editor")
    author = user["username"]

    # Non-owners can only edit their own posts
    if role != "owner" and not user.get("is_admin"):
        old_folder_check = safe_resolve(channel_dir, old_basename)
        if old_folder_check.exists():
            existing_post = read_post(old_folder_check, channel)
            if existing_post.get("author") and existing_post["author"] != user["username"]:
                raise HTTPException(403, "You can only edit your own posts")

    # Input validation
    if len(title) > MAX_TITLE_LENGTH:
        raise HTTPException(400, f"Title too long (max {MAX_TITLE_LENGTH})")
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(400, f"Text too long (max {MAX_TEXT_LENGTH})")
    if len(files) > MAX_FILES_PER_POST:
        raise HTTPException(400, f"Too many files (max {MAX_FILES_PER_POST})")

    old_folder = safe_resolve(channel_dir, old_basename)
    if not old_folder.exists():
        raise HTTPException(404, f"Post '{old_basename}' not found")

    # Preserve original author
    if not author:
        existing = read_post(old_folder, channel)
        author = existing.get("author", "")

    new_basename = basename or old_basename
    validate_path_component(new_basename, "new basename")
    new_folder = safe_resolve(channel_dir, new_basename)

    # Rename folder if basename changed
    if new_basename != old_basename:
        if new_folder.exists() and new_folder != old_folder:
            raise HTTPException(409, f"Post '{new_basename}' already exists")
        old_folder.rename(new_folder)

    # Parse retained files
    try:
        retained = json.loads(retained_files)
    except json.JSONDecodeError:
        retained = []

    # Collect new file names
    new_file_names = []
    for f in files:
        safe_name = sanitize_filename(f.filename)
        validate_file_extension(safe_name)
        new_file_names.append(safe_name)

    # Remove files not in retained or new uploads
    keep = set(retained) | set(new_file_names)
    for f in new_folder.iterdir():
        if f.is_file() and f.suffix.lower() != ".md" and f.name not in keep:
            f.unlink()

    # Save new files (streaming)
    for i, f in enumerate(files):
        dest = safe_resolve(new_folder, new_file_names[i])
        size = 0
        with open(dest, "wb") as out:
            while chunk := await f.read(256 * 1024):
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(400, f"File '{new_file_names[i]}' too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")
                out.write(chunk)

    # Read original created_at before removing old .md
    original_created_at = None
    for md_file in new_folder.glob("*.md"):
        content = md_file.read_text(encoding="utf-8")
        ca_match = re.search(r"created_at:\s*(.+)", content)
        if ca_match:
            original_created_at = ca_match.group(1).strip()
        md_file.unlink()

    all_files = [f.name for f in sorted(new_folder.iterdir()) if f.is_file() and f.suffix.lower() != ".md"]

    # Preserve original created_at
    created_at = original_created_at or datetime.now(timezone.utc).astimezone().isoformat()
    md = generate_md(new_basename, title, text, all_files, created_at, author=author, hidden=hidden)
    (new_folder / f"{new_basename}.md").write_text(md, encoding="utf-8")

    logger.info("Updated post in %s: %s -> %s", channel, old_basename, new_basename)
    return read_post(new_folder, channel)


@app.delete("/api/channels/{channel}/posts/{basename}")
async def delete_channel_post(channel: str, basename: str, request: Request):
    validate_channel_name(channel)
    validate_path_component(basename, "basename")
    channel_dir = safe_resolve(POSTS_DIR, channel)
    folder = safe_resolve(channel_dir, basename)
    if not folder.exists():
        raise HTTPException(404, f"Post '{basename}' not found")

    # Permission check
    user = require_user(request)
    role = check_channel_permission(channel, user, "editor")

    # Non-owners can only delete their own posts
    if role != "owner" and not user.get("is_admin"):
        post = read_post(folder, channel)
        if post.get("author") and post["author"] != user["username"]:
            raise HTTPException(403, "You can only delete your own posts")

    shutil.rmtree(folder)
    logger.info("Deleted post in %s: %s", channel, basename)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

# [THUMBNAILS] Image & video thumbnails
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"}

def _get_or_create_thumbnail(original: Path, width: int) -> Path | None:
    """Return path to cached thumbnail for images or video poster frame"""
    ext = original.suffix.lower()
    is_image = ext in IMAGE_EXTENSIONS
    is_video = ext in VIDEO_EXTENSIONS
    if not is_image and not is_video:
        return None
    if width <= 0 or width >= 2000:
        return None

    thumb_dir = original.parent / ".thumbs"
    thumb_name = f"{original.stem}_{width}.jpg"
    thumb_path = thumb_dir / thumb_name

    if thumb_path.exists() and thumb_path.stat().st_mtime >= original.stat().st_mtime:
        return thumb_path

    thumb_dir.mkdir(exist_ok=True)

    if is_image:
        try:
            from PIL import Image
            with Image.open(original) as img:
                ratio = width / img.width
                if ratio >= 1:
                    return None
                new_size = (width, int(img.height * ratio))
                resized = img.resize(new_size, Image.LANCZOS)
                if resized.mode in ("RGBA", "P"):
                    resized = resized.convert("RGB")
                resized.save(thumb_path, "JPEG", quality=55, optimize=True)
            return thumb_path
        except Exception as e:
            logger.warning("Image thumbnail failed for %s: %s", original, e)
            return None

    if is_video:
        try:
            import cv2
            import numpy as np
            # cv2.VideoCapture doesn't support Unicode paths on Windows
            # Workaround: open file as bytes, write to temp, or use raw bytes
            cap = cv2.VideoCapture(str(original))
            if not cap.isOpened():
                # Fallback for Unicode paths: read file bytes manually
                video_bytes = original.read_bytes()
                temp_path = thumb_dir / "_temp_video.mp4"
                temp_path.write_bytes(video_bytes)
                cap = cv2.VideoCapture(str(temp_path))
                cleanup_temp = True
            else:
                cleanup_temp = False
                temp_path = None

            # Seek to 1 second or 10% of duration
            total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            fps = cap.get(cv2.CAP_PROP_FPS) or 30
            target_frame = min(int(fps), int(total_frames * 0.1)) if total_frames > 0 else int(fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(1, target_frame))
            ret, frame = cap.read()
            if not ret:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret, frame = cap.read()
            cap.release()

            if cleanup_temp and temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)

            if not ret or frame is None:
                return None

            # Resize
            h, w_orig = frame.shape[:2]
            ratio = min(width / w_orig, 1.0)
            new_w, new_h = int(w_orig * ratio), int(h * ratio)
            resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

            # Use imencode + write_bytes for Unicode path support
            ok, buf = cv2.imencode('.jpg', resized, [cv2.IMWRITE_JPEG_QUALITY, 55])
            if ok:
                thumb_path.write_bytes(buf.tobytes())

            if thumb_path.exists():
                return thumb_path
            return None
        except Exception as e:
            logger.warning("Video thumbnail failed for %s: %s", original, e)
            return None

    return None


# [MEDIA] File serving
@app.get("/posts/{channel}/{basename}/{filename}")
async def get_channel_media(
    channel: str, basename: str, filename: str, request: Request,
    w: Optional[int] = None,
):
    validate_channel_name(channel)
    validate_path_component(basename, "basename")
    validate_path_component(filename, "filename")

    # Check channel access for media
    user = get_current_user(request)
    channel_dir = safe_resolve(POSTS_DIR, channel)
    meta = _read_channel_meta(channel_dir)
    if meta.get("visibility") != "public":
        if not user:
            raise HTTPException(401, "Unauthorized")
        check_channel_permission(channel, user, "viewer")

    file_path = safe_resolve(POSTS_DIR, channel, basename, filename)
    if not file_path.exists():
        raise HTTPException(404, "File not found")

    # Serve thumbnail if width requested
    if w:
        thumb = _get_or_create_thumbnail(file_path, w)
        if thumb:
            return FileResponse(thumb)

    return FileResponse(file_path)


# [FRONTEND] SPA static serving
# Also serves index.html for clean URL routes like /c/channel
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    # Never serve frontend for API or media paths — return 404 instead
    if full_path.startswith("api/") or full_path.startswith("posts/"):
        raise HTTPException(404)
    if not FRONTEND_DIR.exists():
        raise HTTPException(404)
    # Prevent path traversal in frontend serving
    if ".." in full_path:
        raise HTTPException(400)
    file_path = (FRONTEND_DIR / full_path).resolve()
    if not str(file_path).startswith(str(FRONTEND_DIR.resolve())):
        raise HTTPException(400)
    if full_path and file_path.is_file():
        return FileResponse(file_path)
    # SPA fallback: serve index.html for client-side routing (/c/channel, etc.)
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(404)
