"""
Milagram — Helpers: validation, sanitization, transliteration, markdown, read_post.
"""
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

import json

from backend.config import (
    POSTS_DIR, ALLOWED_EXTENSIONS, MEDIA_EXTENSIONS,
    CHANNEL_NAME_RE, CHANNEL_RESERVED_NAMES,
    user_store,
)

# ---------------------------------------------------------------------------
# Validation & sanitization
# ---------------------------------------------------------------------------

def validate_path_component(value: str, label: str = "path") -> str:
    if not value or ".." in value or "/" in value or "\\" in value or "\0" in value:
        raise HTTPException(400, f"Invalid {label}")
    return value

def safe_resolve(base: Path, *parts: str) -> Path:
    result = (base / Path(*parts)).resolve()
    if not str(result).startswith(str(base.resolve())):
        raise HTTPException(400, "Path traversal detected")
    return result

def sanitize_filename(name: str) -> str:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f]", "", name)
    if not name:
        raise HTTPException(400, "Empty filename")
    return name

def validate_file_extension(name: str):
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type '{ext}' not allowed")

def validate_channel_name(name: str) -> str:
    if not CHANNEL_NAME_RE.match(name):
        raise HTTPException(400, "Channel name must be 3-32 chars, start with letter, lowercase + digits + _")
    if name in CHANNEL_RESERVED_NAMES:
        raise HTTPException(400, f"Channel name '{name}' is reserved")
    return name

def get_channel_dir(channel: str, must_exist: bool = True) -> Path:
    """Get channel directory. Raises 404 if must_exist and not found"""
    validate_channel_name(channel)
    channel_dir = safe_resolve(POSTS_DIR, channel)
    if must_exist and not channel_dir.exists():
        raise HTTPException(404, f"Channel '{channel}' not found")
    return channel_dir

# ---------------------------------------------------------------------------
# Transliteration
# ---------------------------------------------------------------------------

_CYR = {
    "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"zh",
    "з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o",
    "п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts",
    "ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"," ":"_",
}

def transliterate(text: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", "".join(_CYR.get(c,c) for c in text.lower()))[:40].rstrip("_")

def make_basename(dt: datetime, title: str) -> str:
    p = lambda n: str(n).zfill(2)
    base = f"{dt.year}{p(dt.month)}{p(dt.day)}_{p(dt.hour)}{p(dt.minute)}{p(dt.second)}"
    slug = transliterate(title) if title else ""
    return f"{base}_{slug}" if slug else base

def _read_channel_meta(channel_dir: Path) -> dict:
    meta_file = channel_dir / "_channel.json"
    if meta_file.exists():
        try: return json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception: pass
    return {}

# ---------------------------------------------------------------------------
# Markdown generation
# ---------------------------------------------------------------------------

def generate_md(
    basename: str, title: str, text: str, files: list[str],
    created_at: str, author: str = "", hidden: bool = False,
) -> str:
    """Generate Obsidian-compatible Markdown with YAML frontmatter"""
    # Normalize line endings: browser sends \r\n on Windows,
    # and write_text() in text mode converts \n → \r\n again → double \r
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    title = title.replace("\r\n", "\n").replace("\r", "\n")
    lines = ["---"]
    lines.append(f"created_at: {created_at}")
    if author:
        lines.append(f"author: {author}")
    if hidden:
        lines.append("hidden: true")
    tags = re.findall(r"#([\w\u0430-\u044f\u0451]+)", text, re.IGNORECASE)
    if tags:
        lines.append(f"tags: [{', '.join(tags)}]")
    lines.append("---\n")
    if title:
        lines.append(f"# {title}\n")
    if text:
        lines.append(f"{text}\n")
    for f in files:
        lines.append(f"![[{f}]]")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# [HELPERS] Validation & sanitization
# ---------------------------------------------------------------------------

def read_post(folder: Path, channel: str = "") -> dict:
    """Read a post folder and return a Post dict"""
    basename = folder.name
    md_file = folder / f"{basename}.md"

    title = ""
    text = ""
    created_at = ""
    author = ""
    hidden = False

    if md_file.exists():
        content = md_file.read_text(encoding="utf-8")
        # Parse YAML frontmatter
        fm_match = re.match(r"^---\n(.*?)\n---\n", content, re.DOTALL)
        body = content
        if fm_match:
            fm = fm_match.group(1)
            body = content[fm_match.end():]
            ca_match = re.search(r"created_at:\s*(.+)", fm)
            if ca_match:
                created_at = ca_match.group(1).strip()
            author_match = re.search(r"author:\s*(.+)", fm)
            if author_match:
                author = author_match.group(1).strip()
            if re.search(r"hidden:\s*true", fm):
                hidden = True

        # Parse title (# heading) and text from body
        body = body.strip()
        lines = body.split("\n")
        remaining = []
        for line in lines:
            if line.startswith("# ") and not title:
                title = line[2:].strip()
            elif line.startswith("![[") and line.endswith("]]"):
                pass  # skip file embeds — we reconstruct from disk
            else:
                remaining.append(line)
        text = "\n".join(remaining).strip()

    # Collect files (everything except .md, skip .thumbs dir)
    files = []
    if folder.is_dir():
        for f in sorted(folder.iterdir()):
            if f.is_file() and f.suffix.lower() != ".md" and not f.name.startswith("."):
                entry = {"name": f.name, "size": f.stat().st_size}
                if f.suffix.lower() in MEDIA_EXTENSIONS:
                    entry["type"] = "media"
                else:
                    entry["type"] = "file"
                files.append(entry)

    result = {
        "basename": basename,
        "created_at": created_at,
        "title": title,
        "text": text,
        "files": files,
    }
    if channel:
        result["channel"] = channel
    if author:
        result["author"] = author
    if hidden:
        result["hidden"] = hidden
    return result


def ensure_posts_dir():
    POSTS_DIR.mkdir(parents=True, exist_ok=True)


def _filter_posts_for_user(posts: list[dict], user: Optional[dict], channel_name: str) -> list[dict]:
    """Filter hidden posts based on user's role.

    - owner/admin: sees all posts
    - editor: sees all non-hidden + own hidden posts
    - viewer/anon: sees only non-hidden posts
    """
    if not user:
        return [p for p in posts if not p.get("hidden")]

    if user.get("is_admin"):
        return posts

    role = user_store.get_user_role(channel_name, user["id"])
    if role == "owner":
        return posts

    username = user.get("username", "")
    return [
        p for p in posts
        if not p.get("hidden") or p.get("author") == username
    ]


# ---------------------------------------------------------------------------
