"""
Milagram — Configuration, constants, app init, user store, API keys.
"""
import json
import logging
import os
import re
import secrets
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.getLogger("asyncio").setLevel(logging.CRITICAL)
logger = logging.getLogger("milagram")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

logger = logging.getLogger("milagram")

# ---------------------------------------------------------------------------
# [CONFIG] Configuration
# ---------------------------------------------------------------------------

POSTS_DIR = Path(os.getenv("DATA_DIR", "/data/posts"))
FRONTEND_DIR = Path(os.getenv("FRONTEND_PATH", "/app/frontend"))

# --- API Keys (stored in _api_keys.json) ---
API_KEYS_FILE = POSTS_DIR / "_api_keys.json"

def _load_api_keys() -> list[dict]:
    if API_KEYS_FILE.exists():
        try:
            return json.loads(API_KEYS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []

def _save_api_keys(keys: list[dict]):
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    API_KEYS_FILE.write_text(json.dumps(keys, ensure_ascii=False, indent=2), encoding="utf-8")

def _verify_api_key(key: str) -> dict | None:
    """Check if API key is valid. Returns key dict or None"""
    for k in _load_api_keys():
        if k.get("key") == key and k.get("active", True):
            return k
    return None

OPEN_REGISTRATION_DEFAULT = os.getenv("ALLOW_REGISTRATION", "false").lower() in ("true", "1", "yes")

# ADMIN_PASSWORD — optional, creates initial admin user on first boot
_raw_password = os.getenv("ADMIN_PASSWORD", "")
AUTH_PASSWORD = "" if _raw_password.lower() == "none" else _raw_password

# Secret for JWT signing — auto-generated if not set (tokens invalidate on restart)
JWT_SECRET = os.getenv("JWT_SECRET_KEY") or secrets.token_hex(32)
JWT_EXPIRY_DAYS = int(os.getenv("JWT_EXPIRY_DAYS", "365"))

# Limits
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB per file
MAX_FILES_PER_POST = 20
MAX_TITLE_LENGTH = 500
MAX_TEXT_LENGTH = 50_000
MAX_USERNAME_LENGTH = 32
MIN_PASSWORD_LENGTH = 4

MEDIA_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".bmp", ".svg",
    ".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp",
}

FILE_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".txt", ".csv", ".json", ".xml", ".yaml", ".yml",
    ".zip", ".rar", ".7z", ".tar", ".gz",
    ".mp3", ".wav", ".ogg", ".flac",
    ".py", ".js", ".ts", ".html", ".css", ".sh", ".bat",
}

ALLOWED_EXTENSIONS = MEDIA_EXTENSIONS | FILE_EXTENSIONS

# Channel name validation
CHANNEL_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
USERNAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{1,31}$")
CHANNEL_RESERVED_NAMES = {
    "api", "posts", "static", "assets", "admin", "login", "logout",
    "auth", "settings", "user", "users", "channel", "channels",
    "new", "create", "delete", "edit", "search", "help",
    "register", "invite", "public", "me",
}

app = FastAPI(title="Milagram API", version="5.0.0")

# CORS — configurable via env, defaults to same-origin (no CORS)
_cors_origins = os.getenv("CORS_ORIGINS", "")
if _cors_origins:
    if "*" in _cors_origins.split(","):
        logger.warning(
            "CORS_ORIGINS contains '*' — this is insecure for "
            "production. Set a specific domain instead."
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins.split(","),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-API-Key"],
    )

# ---------------------------------------------------------------------------
# User storage
# ---------------------------------------------------------------------------

from backend.users import JsonFileUserStore
user_store = JsonFileUserStore(POSTS_DIR)

_settings = user_store.get_settings()
if "open_registration" not in _settings:
    _settings["open_registration"] = OPEN_REGISTRATION_DEFAULT
    user_store.save_settings(_settings)

if user_store.user_count() == 0 and AUTH_PASSWORD:
    admin_name = os.getenv("ADMIN_USERNAME", "owner")
    user_store.create_user(admin_name, AUTH_PASSWORD, display_name="Владелец", is_admin=True)
    logger.info("Created initial admin user '%s'", admin_name)

def is_open_registration() -> bool:
    s = user_store.get_settings()
    return s.get("open_registration", OPEN_REGISTRATION_DEFAULT)

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

BACKUP_DIR = POSTS_DIR / ".backups"

