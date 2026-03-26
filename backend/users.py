"""
User Storage Adapter — abstract interface + JSON-file implementation.

Designed for swappability: replace JsonFileUserStore with a PostgreSQL/SQLite
implementation by subclassing UserStore. The rest of the app only talks to
the abstract interface.

File locking: all writes acquire an exclusive lock (fcntl on Unix,
msvcrt on Windows) so concurrent requests don't silently corrupt data.
If a lock can't be acquired within LOCK_TIMEOUT_SEC, a clear error is raised.

Stores users, channel memberships and invites as JSON files.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import bcrypt

logger = logging.getLogger("milagram.users")

# ---------------------------------------------------------------------------
# Platform-specific file locking
# ---------------------------------------------------------------------------

LOCK_TIMEOUT_SEC = 5

try:
    import fcntl

    def _lock(f):
        """Acquire exclusive lock (Unix)"""
        deadline = time.monotonic() + LOCK_TIMEOUT_SEC
        while True:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise TimeoutError(
                        f"Could not acquire file lock on {f.name} "
                        f"within {LOCK_TIMEOUT_SEC}s — another process may be writing"
                    )
                time.sleep(0.05)

    def _unlock(f):
        fcntl.flock(f, fcntl.LOCK_UN)

except ImportError:
    # Windows
    import msvcrt

    def _lock(f):
        """Acquire exclusive lock (Windows)"""
        deadline = time.monotonic() + LOCK_TIMEOUT_SEC
        while True:
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                return
            except (OSError, IOError):
                if time.monotonic() > deadline:
                    raise TimeoutError(
                        f"Could not acquire file lock on {f.name} "
                        f"within {LOCK_TIMEOUT_SEC}s — another process may be writing"
                    )
                time.sleep(0.05)

    def _unlock(f):
        try:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        except (OSError, IOError):
            pass


# ---------------------------------------------------------------------------
# Data types (plain dicts — no ORM, no dataclasses dependency)
# ---------------------------------------------------------------------------
# User dict:   {id, username, display_name, password_hash, is_admin, created_at}
# Member dict: {user_id, username, role, joined_at}
# Invite dict: {token, channel_name, role, created_by, expires_at, max_uses, use_count, created_at}


# ---------------------------------------------------------------------------
# Abstract interface — swap this for PostgreSQL/SQLite/etc.
# ---------------------------------------------------------------------------

class UserStore(ABC):
    """Abstract user/membership/invite storage.

    All methods are synchronous (JSON files don't need async).
    Wrap in run_in_executor() if needed for async FastAPI handlers.
    """

    # --- Users ---

    @abstractmethod
    def create_user(
        self, username: str, password: str,
        display_name: str = "", is_admin: bool = False,
    ) -> dict:
        """Create user. Raises ValueError if username taken"""

    @abstractmethod
    def get_user_by_username(self, username: str) -> Optional[dict]:
        """Return user dict or None"""

    @abstractmethod
    def get_user_by_id(self, user_id: int) -> Optional[dict]:
        """Return user dict or None"""

    @abstractmethod
    def list_users(self) -> list[dict]:
        """Return all users (without password hashes)"""

    @abstractmethod
    def verify_password(self, username: str, password: str) -> Optional[dict]:
        """Check password. Returns user dict (without hash) or None"""

    @abstractmethod
    def user_count(self) -> int:
        """Total number of registered users"""

    @abstractmethod
    def delete_user(self, user_id: int) -> bool:
        """Delete a user and all their memberships. Returns True if user existed"""

    # --- Settings ---

    @abstractmethod
    def get_settings(self) -> dict:
        """Return app settings dict"""

    @abstractmethod
    def save_settings(self, settings: dict) -> None:
        """Save app settings"""

    # --- Channel members ---

    @abstractmethod
    def get_channel_members(self, channel_name: str) -> list[dict]:
        """List members of a channel"""

    @abstractmethod
    def get_user_role(self, channel_name: str, user_id: int) -> Optional[str]:
        """Return role ('owner'/'editor'/'viewer') or None if not a member"""

    @abstractmethod
    def add_channel_member(
        self, channel_name: str, user_id: int, role: str = "viewer",
    ) -> None:
        """Add user to channel. Updates role if already a member"""

    @abstractmethod
    def remove_channel_member(self, channel_name: str, user_id: int) -> None:
        """Remove user from channel"""

    @abstractmethod
    def get_user_channels(self, user_id: int) -> list[str]:
        """List channel names the user is a member of"""

    # --- Invites ---

    @abstractmethod
    def create_invite(
        self, channel_name: str, role: str, created_by: int,
        expires_at: Optional[str] = None, max_uses: int = 1,
    ) -> dict:
        """Create an invite token. Returns invite dict"""

    @abstractmethod
    def get_invite(self, token: str) -> Optional[dict]:
        """Return invite dict or None"""

    @abstractmethod
    def use_invite(self, token: str) -> bool:
        """Increment use_count. Returns False if expired/exhausted"""

    @abstractmethod
    def list_invites(self, channel_name: str) -> list[dict]:
        """List all invites for a channel"""

    @abstractmethod
    def delete_invite(self, token: str) -> None:
        """Delete an invite"""


# ---------------------------------------------------------------------------
# JSON-file implementation
# ---------------------------------------------------------------------------

class JsonFileUserStore(UserStore):
    """Stores users, memberships, and invites in JSON files under data_dir.

    Files:
      {data_dir}/_users.json     — user accounts
      {data_dir}/_members.json   — channel memberships
      {data_dir}/_invites.json   — invite tokens

    All writes use file locking to prevent corruption from concurrent requests.
    Reads are lock-free (atomic on most OS for small files).
    """

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._users_file = self.data_dir / "_users.json"
        self._members_file = self.data_dir / "_members.json"
        self._invites_file = self.data_dir / "_invites.json"
        self._settings_file = self.data_dir / "_settings.json"

        # Initialize files if they don't exist
        for f in (self._users_file, self._members_file, self._invites_file):
            if not f.exists():
                f.write_text("[]", encoding="utf-8")
        if not self._settings_file.exists():
            self._settings_file.write_text("{}", encoding="utf-8")

        logger.info(
            "JsonFileUserStore initialized: %s (%d users)",
            self.data_dir, self.user_count(),
        )

    # --- Internal I/O with locking ---

    def _read_json(self, path: Path) -> list:
        """Read JSON array from file. Returns [] on error"""
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError, OSError) as e:
            logger.error("Failed to read %s: %s", path, e)
            return []

    def _write_json(self, path: Path, data: list) -> None:
        """Write JSON array to file with exclusive lock.

        Uses write-to-temp-then-rename for atomicity where possible.
        Raises TimeoutError if lock cannot be acquired.
        """
        tmp_path = path.with_suffix(".tmp")
        content = json.dumps(data, ensure_ascii=False, indent=2)
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                _lock(f)
                try:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                finally:
                    _unlock(f)
            # Atomic rename (on same filesystem)
            tmp_path.replace(path)
        except TimeoutError:
            # Clean up temp file on lock failure
            tmp_path.unlink(missing_ok=True)
            raise
        except OSError as e:
            tmp_path.unlink(missing_ok=True)
            raise OSError(f"Failed to write {path}: {e}") from e

    def _next_user_id(self, users: list) -> int:
        """Generate next user ID"""
        if not users:
            return 1
        return max(u["id"] for u in users) + 1

    # --- Users ---

    def create_user(
        self, username: str, password: str,
        display_name: str = "", is_admin: bool = False,
    ) -> dict:
        users = self._read_json(self._users_file)

        # Check uniqueness
        if any(u["username"] == username for u in users):
            raise ValueError(f"Username '{username}' is already taken")

        password_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")

        user = {
            "id": self._next_user_id(users),
            "username": username,
            "display_name": display_name or username,
            "password_hash": password_hash,
            "is_admin": is_admin,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        users.append(user)
        self._write_json(self._users_file, users)

        logger.info("Created user: %s (id=%d, admin=%s)", username, user["id"], is_admin)
        return self._safe_user(user)

    def get_user_by_username(self, username: str) -> Optional[dict]:
        users = self._read_json(self._users_file)
        for u in users:
            if u["username"] == username:
                return self._safe_user(u)
        return None

    def get_user_by_id(self, user_id: int) -> Optional[dict]:
        users = self._read_json(self._users_file)
        for u in users:
            if u["id"] == user_id:
                return self._safe_user(u)
        return None

    def list_users(self) -> list[dict]:
        users = self._read_json(self._users_file)
        return [self._safe_user(u) for u in users]

    def verify_password(self, username: str, password: str) -> Optional[dict]:
        users = self._read_json(self._users_file)
        for u in users:
            if u["username"] == username:
                if bcrypt.checkpw(
                    password.encode("utf-8"),
                    u["password_hash"].encode("utf-8"),
                ):
                    return self._safe_user(u)
                return None
        return None

    def user_count(self) -> int:
        return len(self._read_json(self._users_file))

    @staticmethod
    def _safe_user(user: dict) -> dict:
        """Return user dict without password_hash"""
        return {k: v for k, v in user.items() if k != "password_hash"}

    def update_user(self, user_id: int, display_name: str = None, username: str = None, password: str = None) -> dict | None:
        """Update user profile. Returns updated user or None"""
        users = self._read_json(self._users_file)
        user = None
        for u in users:
            if u["id"] == user_id:
                user = u
                break
        if not user:
            return None
        if display_name is not None:
            user["display_name"] = display_name
        if username is not None:
            for u in users:
                if u["username"] == username and u["id"] != user_id:
                    raise ValueError(f"Username '{username}' already taken")
            user["username"] = username
        if password is not None:
            import bcrypt
            user["password_hash"] = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        self._write_json(self._users_file, users)
        return self._safe_user(user)

    def delete_user(self, user_id: int) -> bool:
        users = self._read_json(self._users_file)
        before = len(users)
        users = [u for u in users if u["id"] != user_id]
        if len(users) == before:
            return False
        self._write_json(self._users_file, users)
        # Also remove all memberships
        members = self._read_json(self._members_file)
        members = [m for m in members if m["user_id"] != user_id]
        self._write_json(self._members_file, members)
        logger.info("Deleted user id=%d and their memberships", user_id)
        return True

    # --- Settings ---

    def get_settings(self) -> dict:
        try:
            return json.loads(self._settings_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, FileNotFoundError, OSError):
            return {}

    def save_settings(self, settings: dict) -> None:
        self._write_json_obj(self._settings_file, settings)

    def _write_json_obj(self, path: Path, data: dict) -> None:
        """Write JSON object (not array) with locking"""
        tmp_path = path.with_suffix(".tmp")
        content = json.dumps(data, ensure_ascii=False, indent=2)
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                _lock(f)
                try:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                finally:
                    _unlock(f)
            tmp_path.replace(path)
        except TimeoutError:
            tmp_path.unlink(missing_ok=True)
            raise
        except OSError as e:
            tmp_path.unlink(missing_ok=True)
            raise OSError(f"Failed to write {path}: {e}") from e

    # --- Channel members ---

    def get_channel_members(self, channel_name: str) -> list[dict]:
        members = self._read_json(self._members_file)
        raw = [m for m in members if m["channel_name"] == channel_name]
        # Enrich with display_name
        users = self._read_json(self._users_file)
        user_map = {u["id"]: u for u in users}
        result = []
        for m in raw:
            entry = {
                "channel_name": m["channel_name"],
                "user_id": m["user_id"],
                "role": m["role"],
                "joined_at": m.get("joined_at", ""),
            }
            u = user_map.get(m["user_id"])
            if u:
                entry["username"] = u["username"]
                entry["display_name"] = u.get("display_name", u["username"])
            result.append(entry)
        return result

    def get_user_role(self, channel_name: str, user_id: int) -> Optional[str]:
        members = self._read_json(self._members_file)
        for m in members:
            if m["channel_name"] == channel_name and m["user_id"] == user_id:
                return m["role"]
        return None

    def add_channel_member(
        self, channel_name: str, user_id: int, role: str = "viewer",
    ) -> None:
        members = self._read_json(self._members_file)
        # Update if exists
        for m in members:
            if m["channel_name"] == channel_name and m["user_id"] == user_id:
                m["role"] = role
                self._write_json(self._members_file, members)
                logger.info("Updated member role: user=%d channel=%s role=%s", user_id, channel_name, role)
                return
        # Add new
        members.append({
            "channel_name": channel_name,
            "user_id": user_id,
            "role": role,
            "joined_at": datetime.now(timezone.utc).isoformat(),
        })
        self._write_json(self._members_file, members)
        logger.info("Added member: user=%d channel=%s role=%s", user_id, channel_name, role)

    def remove_channel_member(self, channel_name: str, user_id: int) -> None:
        members = self._read_json(self._members_file)
        before = len(members)
        members = [
            m for m in members
            if not (m["channel_name"] == channel_name and m["user_id"] == user_id)
        ]
        if len(members) < before:
            self._write_json(self._members_file, members)
            logger.info("Removed member: user=%d channel=%s", user_id, channel_name)

    def get_user_channels(self, user_id: int) -> list[str]:
        members = self._read_json(self._members_file)
        return [m["channel_name"] for m in members if m["user_id"] == user_id]

    # --- Invites ---

    def create_invite(
        self, channel_name: str, role: str, created_by: int,
        expires_at: Optional[str] = None, max_uses: int = 1,
    ) -> dict:
        invites = self._read_json(self._invites_file)
        invite = {
            "token": secrets.token_urlsafe(32),
            "channel_name": channel_name,
            "role": role,
            "created_by": created_by,
            "expires_at": expires_at,
            "max_uses": max_uses,
            "use_count": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        invites.append(invite)
        self._write_json(self._invites_file, invites)
        logger.info("Created invite for channel=%s role=%s by user=%d", channel_name, role, created_by)
        return invite

    def get_invite(self, token: str) -> Optional[dict]:
        invites = self._read_json(self._invites_file)
        for inv in invites:
            if inv["token"] == token:
                return inv
        return None

    def use_invite(self, token: str) -> bool:
        """Increment use_count. Returns False if expired or max_uses reached"""
        invites = self._read_json(self._invites_file)
        for inv in invites:
            if inv["token"] == token:
                # Check expiry
                if inv.get("expires_at"):
                    try:
                        exp = datetime.fromisoformat(inv["expires_at"])
                        if datetime.now(timezone.utc) > exp:
                            logger.warning("Invite %s... expired", token[:8])
                            return False
                    except ValueError:
                        pass
                # Check uses
                if inv["use_count"] >= inv["max_uses"]:
                    logger.warning("Invite %s... exhausted (%d/%d)", token[:8], inv["use_count"], inv["max_uses"])
                    return False
                inv["use_count"] += 1
                self._write_json(self._invites_file, invites)
                return True
        return False

    def list_invites(self, channel_name: str) -> list[dict]:
        invites = self._read_json(self._invites_file)
        return [inv for inv in invites if inv["channel_name"] == channel_name]

    def delete_invite(self, token: str) -> None:
        invites = self._read_json(self._invites_file)
        before = len(invites)
        invites = [inv for inv in invites if inv["token"] != token]
        if len(invites) < before:
            self._write_json(self._invites_file, invites)
            logger.info("Deleted invite %s...", token[:8])
