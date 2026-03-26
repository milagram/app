"""
Milagram FastAPI Backend — entry point.

Imports all modules to register routes and middleware on the app.
The actual code lives in:
  - config.py      — env vars, constants, app init, user store, API keys
  - auth.py        — security middleware, JWT, login/register, permissions
  - multi_user.py  — user management, members, invites, admin panel
  - helpers.py     — validation, sanitization, markdown, read_post
  - routes.py      — all API routes (channels, posts, media, backup, import)
  - users.py       — UserStore adapter (JSON file storage)
"""

# Import config first (creates app, user_store)
from backend.config import app  # noqa: F401

# Import auth (registers middleware)
import backend.auth  # noqa: F401

# Import multi-user endpoints
import backend.multi_user  # noqa: F401

# Import all routes
import backend.routes  # noqa: F401
