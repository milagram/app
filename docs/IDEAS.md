# Milagram — Ideas & Future Plans

Ideas that are not yet in development but worth
exploring. Each section is independent.

---

## 1. Cloud Backup & Sync

### Problem

Data lives on one server. If the disk dies —
everything is lost. Manual backups (ZIP from admin
panel) work but require discipline.

### Idea: Bidirectional sync with cloud storage

Set up sync entirely from UI (admin panel), no SSH:

1. User picks a cloud provider (Yandex Disk, Google
   Drive, Nextcloud...)
2. Clicks "Connect" → OAuth2 login → token saved
3. Picks a folder in the cloud
4. Enables sync → backend periodically syncs

**Sync strategy: local wins.**
Milagram is the source of truth. If a file appears
in the cloud (uploaded manually) — download it.
If conflict — local version wins.

### Technical approach

**WebDAV** covers multiple providers with one client:
Yandex Disk, Nextcloud, ownCloud, Mail.ru.
Google Drive needs separate REST API v3 client.

Components needed:

| Component | ~Lines | ~Time |
|-----------|--------|-------|
| OAuth2 flow (UI + backend) | 300 | 2-3 days |
| Admin panel (sync settings) | 200 | 1-2 days |
| WebDAV client | 400 | 2-3 days |
| Sync engine (diff + conflicts) | 500 | 3-5 days |
| Google Drive client | 400 | 2-3 days |
| **Total (first provider)** | **~1400** | **~2 weeks** |
| **Each next provider** | **~400** | **~3 days** |

**Conflict resolution options:**

| Strategy | How | Best for |
|----------|-----|----------|
| Last write wins | Latest change wins | Simple backup |
| Local wins | Local version is always primary | Milagram = truth |
| Cloud wins | Cloud version is primary | Cloud = truth |

Recommendation: **local wins** for Milagram.

### Simpler alternative (zero code)

Use rclone as an external tool:

```bash
# One-way backup every 30 min
*/30 * * * * rclone sync /data/posts yadisk:milagram

# Or mount cloud as local folder
rclone mount yadisk:milagram /data/posts \
  --vfs-cache-mode full
```

Works with 50+ cloud providers. No code changes.
But requires SSH access and rclone installation.

---

## 2. Cloud-Only Storage (No Local Server)

### Problem

Current architecture requires a server (VPS, home
server, NAS). Not everyone has one or wants to
maintain one.

### Idea: Store all data directly in the cloud

User installs only the frontend (static site) and
connects their own cloud storage. No backend needed.

**How it would work:**
- Frontend talks directly to cloud API via JS SDK
- Posts stored as folders in user's Yandex Disk /
  Google Drive (same folder structure as now)
- Auth via cloud provider's OAuth2
- No server to maintain — just open a URL

**What changes:**
- New `CloudAdapter` in api.ts (same interface as
  HttpAdapter / MockAdapter)
- OAuth2 flow in browser
- No server-side thumbnails (generate in browser
  via canvas, or use cloud's thumbnail API)
- No file locking (single-user or optimistic)
- No user management (cloud account = user)

**Challenges:**
- CORS restrictions with cloud APIs
- No server-side search (search in browser only,
  limited to loaded posts)
- Thumbnail generation in browser is slow for
  large images
- Each cloud provider has different API, different
  limits, different folder structure quirks
- Offline support becomes critical (no server to
  fall back to)

**Estimate:** 2+ months. This is essentially a
different product — a static SPA that uses cloud
storage as a backend.

**When it makes sense:** If there's demand for
"zero infrastructure" usage. Could be a separate
deployment mode alongside the current server mode.

---

## 3. Public Blog from Open Channels

### Problem

Milagram already has public channels (`visibility:
"public"`) readable without auth via
`/api/public/{channel}/posts`. But there's no
dedicated blog-style UI for external visitors.

### Idea: Blog view for public channels

A read-only, beautiful, SEO-friendly page that
renders a public channel as a blog. Share a link
like `milagram.example.com/blog/travel` and anyone
can read it — no login, no app installation.

**What it could look like:**
- Clean, minimal layout (no sidebar, no composer)
- Posts rendered as blog entries with dates
- Media displayed inline (photos, videos)
- Responsive (mobile-friendly)
- Open Graph meta tags for link previews
- RSS feed (`/blog/travel/rss`)

**Technical approach:**

Option A — **Server-rendered HTML** (SSR):
- New FastAPI route `/blog/{channel}` returns
  rendered HTML
- Jinja2 templates or simple string formatting
- Good for SEO (Google can index)
- ~500 lines of Python + HTML template

Option B — **Static site generator**:
- CLI tool that reads posts and generates HTML
- Deploy to GitHub Pages / Netlify / Cloudflare
- Zero server load for readers
- But not realtime — needs rebuild on new post

Option C — **SPA route in existing frontend**:
- New React route `/blog/{channel}`
- Fetches from `/api/public/{channel}/posts`
- Quick to implement (~200 lines)
- But not SEO-friendly (SPA, no SSR)

**Recommendation:** Option A (server-rendered) for
SEO + simplicity. Option C as a quick first step.

**Estimate:**
- Option C (SPA): 1-2 days
- Option A (SSR): 3-5 days
- Option B (static): 1 week (with CLI tool)

**Nice to have:**
- Custom domain per blog
- Themes (light/dark/minimal)
- Comments (external: Disqus, or own system)
- Newsletter subscription

---

## API Reference: Immich

Immich (https://immich.app) is the closest open-source analog to Milagram:
self-hosted photo/video management with a mobile-first approach.

**Why it matters:**
- 50k+ GitHub stars, active development
- Has a production Android + iOS client (Flutter)
- Full OpenAPI documentation: https://immich.app/docs/api
- Server endpoint design used as reference for Milagram's `/api/server/*`

**Endpoints we adopted from Immich:**
- `GET /api/server/ping` — liveness check (`{"res": "pong"}`)
- `GET /api/server/info` — server version and config for clients

**Worth studying for future mobile client work:**
- Auth flow (OAuth + API keys)
- Chunked upload with resume
- Asset sync (`/api/sync/*` delta-sync endpoints)
- Server-side ML features (face detection, CLIP search)

---

## Priority

| Idea | Value | Effort | Priority |
|------|-------|--------|----------|
| Cloud backup (rclone) | high | zero | **now** |
| Cloud sync (WebDAV) | high | 2 weeks | medium |
| Blog from public channel | medium | 3-5 days | medium |
| Cloud-only storage | medium | 2+ months | low |
