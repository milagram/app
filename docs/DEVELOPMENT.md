# Milagram — Developer Guide

**Version:** 2.0
**Date:** 2026-03-25

## Quick Start

### 1. Set Up Environment Variables

```bash
cp .env.example .env
# Edit .env — at minimum set ADMIN_PASSWORD
```

### 2. Run

**Linux/macOS:**
```bash
# Terminal 1 — backend (loads .env automatically)
pip install -r backend/requirements.txt
set -a && source .env && set +a
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```

**Windows (PowerShell):**
```powershell
# Terminal 1 — backend
pip install -r backend\requirements.txt
Get-Content .env | ForEach-Object { if ($_ -match '^([^#].+?)=(.+)$') { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend
cd frontend; npm install; npm run dev
```

**Docker:**
```bash
docker compose up -d --build    # automatically picks up .env
```

Frontend: `http://localhost:5173`
(Vite proxy -> backend on 8000)
First login: username from `ADMIN_USERNAME`
(default `owner`), password from `ADMIN_PASSWORD`

### Environment Files

| File | Purpose | In git |
|------|---------|--------|
| `.env.example` | Template with comments | Yes |
| `.env` | Actual values (passwords!) | No (.gitignore) |

Docker Compose picks up `.env` via
`env_file: .env`. Without Docker — `source .env` (bash)
or the PowerShell one-liner.

---

## Cleanup

### Cleanup for Copying / Transferring the Project

Removes everything that is auto-generated.
After copying: `cd frontend && npm install`.

**Linux / macOS:**
```bash
# node_modules (~300MB) and build output
rm -rf frontend/node_modules
rm -rf frontend/dist

# Python cache
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find . -name "*.pyc" -delete 2>/dev/null

# Thumbnails (will be regenerated on first request)
find posts -name ".thumbs" -type d -exec rm -rf {} + 2>/dev/null

# Backups
rm -rf posts/.backups

# Check size
du -sh .
```

**Windows (PowerShell):**
```powershell
# node_modules and build output
Remove-Item -Recurse -Force frontend\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force frontend\dist -ErrorAction SilentlyContinue

# Python cache
Get-ChildItem -Recurse -Directory -Name "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Thumbnails
Get-ChildItem -Recurse -Directory -Name ".thumbs" posts -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -Recurse -Force $_.FullName }

# Backups
Remove-Item -Recurse -Force posts\.backups -ErrorAction SilentlyContinue
```

### Quick Cleanup (caches only, keeping node_modules)

**Linux / macOS:**
```bash
rm -rf frontend/node_modules/.vite
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find posts -name ".thumbs" -type d -exec rm -rf {} + 2>/dev/null
```

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force frontend\node_modules\.vite -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Directory -Name "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
```

### Full Cleanup (fresh start, including data)

**Linux / macOS:**
```bash
rm -rf posts/ frontend/node_modules frontend/dist
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
```

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force posts, frontend\node_modules, frontend\dist -ErrorAction SilentlyContinue
Get-ChildItem -Recurse -Directory -Name "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
```

---

## Project Structure

```
milagram/
├── frontend/                  # React 19 + TypeScript + Vite 6
│   ├── src/
│   │   ├── main.tsx           # Entry point
│   │   ├── App.tsx            # Router, Sidebar, Header
│   │   ├── Feed.tsx           # Post feed, drag-and-drop, pagination
│   │   ├── Composer.tsx       # Input form, DatePicker, templates
│   │   ├── Lightbox.tsx       # Fullscreen media viewer
│   │   ├── Panels.tsx         # ProfilePage, AdminPanel, DebugPanel, MembersPanel
│   │   ├── Auth.tsx           # Login, Register, Invite
│   │   ├── api.ts             # HttpAdapter, MockAdapter, auth, types
│   │   ├── store.ts           # Zustand state
│   │   ├── utils.ts           # Markdown, dates, transliterate, highlight.js
│   │   ├── composer-logic.ts  # Pure functions (normalize, validate, build)
│   │   ├── i18n.ts            # i18next config (RU/EN translations)
│   │   └── styles/app.css     # All styles
│   ├── vite.config.ts         # Dev server, proxy /api → :8000
│   └── package.json
├── backend/
│   ├── main.py                # Entry point (module imports)
│   ├── config.py              # Env vars, constants, app init
│   ├── auth.py                # JWT, middleware, login/register
│   ├── helpers.py             # Validation, transliteration, markdown
│   ├── routes.py              # API routes (channels, posts, media, backup)
│   ├── multi_user.py          # Users, members, invites, admin
│   ├── users.py               # UserStore adapter (JSON + file locking)
│   └── requirements.txt
├── tools/
│   └── import_telegram.py     # CLI import from Telegram
├── docs/
│   ├── DESIGN.md              # Architecture and design decisions
│   ├── INTERACTION_SPEC.md    # Micro-interaction specification
│   ├── DEVELOPMENT.md         # This file
│   └── TESTING.md             # Tests
├── Dockerfile
├── docker-compose.yml
└── README.md                  # User documentation
```

---

## Tests

```bash
cd frontend
npx tsx src/composer-logic.test.ts    # 49 pure function tests
npx tsc --noEmit                      # TypeScript check
```

---

## Useful Commands

### Backend

```bash
# Run with auto-reload
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Without authentication (dev)
ADMIN_PASSWORD=none uvicorn backend.main:app --port 8000

# Health check
curl http://localhost:8000/api/auth/check
```

### Frontend

```bash
# Dev server
npm run dev

# Production build
npm run build

# Type check
npx tsc --noEmit

# Rebuild Vite cache (if 504 errors)
rm -rf node_modules/.vite && npm run dev
```

### Docker

```bash
docker build -t milagram .
docker run -d -p 8000:8000 -v ./data:/data/posts -e ADMIN_PASSWORD=mypass milagram

# Logs
docker logs -f <container>
```

### Data

```bash
# Import from Telegram
python tools/import_telegram.py --channel family --posts-dir ./posts ./export/result.json

# Backup via API
curl -X POST http://localhost:8000/api/ext/backup -H "X-API-Key: sk-..."

# List posts
curl http://localhost:8000/api/ext/posts/family?limit=5 -H "X-API-Key: sk-..."
```

---

## Architectural Decisions

### Backend Structure

| File | Lines | Contents |
|------|-------|----------|
| `main.py` | 24 | Entry point — imports all modules |
| `config.py` | 133 | Env vars, constants, app init, user store, API keys |
| `auth.py` | 306 | Middleware, JWT, login/register, permissions |
| `multi_user.py` | 443 | Users, members, invites, admin panel |
| `helpers.py` | 238 | Validation, transliteration, markdown, read_post |
| `routes.py` | 986 | All API routes (channels, posts, media, backup, import) |
| `users.py` | 534 | UserStore adapter (JSON files, locking) |

### Why No Single-User Mode
A deliberate decision. One code path = no
`if singleUser` in every endpoint, middleware,
component. For a family of 2-4 people, multi-user
is no harder — `ADMIN_PASSWORD=xxx` creates the
admin automatically.

### Why Zustand Instead of Redux
Minimal API, no boilerplate. Store in a single
file. Persist out of the box.

### Why CSS Instead of Tailwind/CSS Modules
One `app.css` file — easier to search, override,
and debug. CSS custom properties for dark mode.
No build dependencies.

### Why Pointer Events Instead of HTML5 DnD
HTML5 DnD shows a forbidden cursor between zones,
offers no control over the ghost element, and
doesn't work on touch devices. Pointer Events —
one codebase for mouse and touch.

### Why Thumbnails in `.thumbs/` Inside the Post
When a post is renamed (reorder), the cache moves
with it. On deletion — `shutil.rmtree` cleans up
everything. Obsidian hides dot-prefixed folders.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/data/posts` | Data directory |
| `FRONTEND_PATH` | `/app/frontend` | Static files (production) |
| `ADMIN_PASSWORD` | — | Initial admin password |
| `ADMIN_USERNAME` | `owner` | Initial admin username |
| `ALLOW_REGISTRATION` | `false` | Open registration |
| `JWT_SECRET_KEY` | *(auto)* | JWT secret |
| `JWT_EXPIRY_DAYS` | `365` | Token lifetime |
| `CORS_ORIGINS` | — | CORS domains |

---

## Debugging

### Vite 504 "Outdated Optimize Dep"
```bash
rm -rf frontend/node_modules/.vite
# Restart npm run dev
```

### Double Line Breaks in Code
Windows `\r\n` + Python `write_text()` = `\r\r\n`.
The backend normalizes this in `generate_md()`.

### Video Thumbnails Not Generated (Cyrillic in Filename)
OpenCV `VideoCapture` doesn't support Unicode paths
on Windows. The backend copies to a temporary file.

### Drag-and-Drop: Media 404 After Reorder
Race condition: `setPosts` updates the UI with the
new basename before the backend has renamed the
folder. Solution: optimistic update preserves the
old basename for media URLs.
