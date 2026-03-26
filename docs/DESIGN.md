# Milagram — Design Document

**Version:** 7.2
**Date:** 2026-03-25
**Status:** Production-ready

---

## 0. About the structure of this document

This document is inspired by several project
documentation standards:

- **IEEE 1016 (SDD)** — Software Design
  Description: separation into architecture,
  components, interfaces, dependencies.
  Sections 2 (architecture), 5 (backend),
  7 (dependencies) originate from this.
- **arc42** — architecture documentation template:
  context, decisions, constraints, deployment.
  Sections 1 (overview), 9 (constraints),
  10 (roadmap) originate from this.
- **ADR (Architecture Decision Records)** —
  documenting decisions with "why" rationale.
  The "Why" blocks throughout the document
  originate from this: why React, why Pointer
  Events, why a folder per post.
- **C4 Model** — abstraction levels: Context →
  Container → Component. Diagrams in sections
  2.2 and 5.1 originate from this.

The goal is not formal compliance with standards,
but a readable document answering two questions:
**"what was done"** and **"why this way"**.

> This section is a meta-description of the structure.
> Do not remove when updating the document.

---

## 1. Project Overview

### 1.1 Purpose

Milagram is a self-hosted family micro-journal combining the features of:

- **Habit tracker** — "Took vitamin D #health"
- **Photo album** — photos and videos tied to timestamps
- **Daily planner** — long-form notes in Markdown
- **Event diary** — "Grandma's birthday #family"

### 1.2 Core Idea

Each entry is an **Obsidian folder**:
`YYYYMMDD_HHMMSS_slug/` with `.md` and media.
Entries are grouped by **channels** — logical
sections (family, health, travel).
The app is merely a **beautiful interface** over
the filesystem.

### 1.3 Target Audience

A family of 2–4 people using the app on mobile and desktop devices.
Entries are made quickly, like messages in a messenger.

---

## 2. Architecture Decisions

### 2.1 Technology Stack

| Decision | Reason |
|---------|---------|
| React 19 + TypeScript | Type safety, component-based approach, hooks |
| Vite 6 | Instant HMR, proxy for API |
| Zustand v5 + persist | Minimal state manager, localStorage sync |
| CSS Custom Properties | Theming without a preprocessor, dark mode |

### 2.2 Data Adapter

```
┌──────────────┐     ┌──────────────────┐
│  App.tsx     │────▶│   api.ts         │ ← types, adapters, auth
│  Feed.tsx    │     │   ┌────────────┐ │
│  Composer    │     │   │MockAdapter │ │ ← in-memory demo data
└──────────────┘     │   │HttpAdapter │ │ ← requests to FastAPI
                     │   └────────────┘ │
                     └──────────────────┘
```

All in a single file `api.ts`:
- `HttpAdapter` — CRUD + auth + upload progress + thumbnails
- `MockAdapter` — in-memory demo data (works without backend)
- Auto-detection: `GET /api/auth/check`
  (2s timeout) → HttpAdapter or MockAdapter

### 2.3 Data Structures

#### Channel

```javascript
{
    name: "family",             // Slug — used in URLs and on disk
    displayName: "Семья",       // Optional — displayed in the UI
    emoji: "👨‍👩‍👧",                // Optional — selected from a palette
    description: "Семейный дневник",
    postCount: 5,
    createdAt: "2026-03-20T08:00:00+03:00"
}
```

**Channel address (slug):**
- Only `[a-z][a-z0-9_]{2,31}`
- Deny-list of reserved names (api, posts, admin, login, etc.)
- Cannot be changed after creation

**Channel name (displayName):**
- Any language (Russian, English, etc.)
- Optional — if not set, the slug is displayed
- Can be changed later

#### Post

```javascript
{
    basename: "20260320_083000_vitamin_d",  // ID = folder name
    createdAt: "2026-03-20T08:30:00+03:00", // ISO 8601
    title:    "Выпил витамин D",            // Title (primary)
    text:     "Утренняя доза...",            // Description (Markdown)
    files: [                                // Media files
        { name: "photo.jpg", url: "blob:..." },
        { name: "video.mp4" }
    ],
    channel: "family"                       // Owning channel
}
```

### 2.4 On-disk File Format (Obsidian-ready)

```
/data/posts/
  family/                              ← channel
    _channel.json                      ← channel metadata
    20260320_083000_vitamin_d/         ← post
      20260320_083000_vitamin_d.md     ← YAML frontmatter + Markdown
      photo.jpg                        ← media
    20260320_101500_progulka/
      20260320_101500_progulka.md
      park1.jpg
      video.mp4
  health/                              ← another channel
    _channel.json
    ...
```

`_channel.json`:
```json
{
  "name": "family",
  "displayName": "Семья",
  "emoji": "👨‍👩‍👧",
  "description": "Семейный дневник",
  "createdAt": "2026-03-20T08:00:00+03:00"
}
```

Markdown with frontmatter:
```markdown
---
created_at: 2026-03-20T08:30:00+03:00
tags: [таблетки, здоровье]
---

# Выпил витамин D

Утренняя доза витамина.

![[photo.jpg]]
![[video.mp4]]
```

### 2.5 Client-side Routing (Clean URLs)

```
/                → redirect to the first channel
/c/family        → channel "family" (displayed as "Семья")
/c/health        → channel "health" (displayed as "Здоровье")
```

- `history.pushState` / `popstate` — no hash fragments
- Backend: SPA-fallback — all unknown paths → `index.html`
- Browser-only: `npx serve -s .` (`-s` flag for SPA)
- Deep link through login: URL is saved in
  `state.pendingRoute`, restored after
  authentication
- Reserved URL prefixes: `/c/`, `/api/`, `/posts/`

---

## 3. UX Decisions

### 3.1 Title-Primary Input

**Problem:** Most entries are short
("Took pills", "Walk in the park").
A description is rarely needed, but when it is — it should be convenient.

**Solution:** Title = primary field, description = toggle `Aa`.

```
┌──────────────────────────────────────┐
│  Entry, #tags...                     │  ← primary: Enter = submit
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  More details... (Markdown)          │  ← only if Aa is pressed
│                                      │
│  ◷  +  Aa                       [↑] │  ← toolbar always at bottom
└──────────────────────────────────────┘
```

### 3.2 Channel Sidebar (v5.0)

A vertical list of channels in a side panel on the left (Telegram-style).

```
┌─────────────────┐
│ Milagram     × │  ← header (× only on mobile)
├─────────────────┤
│ 👨‍👩‍👧 Семья    5  │  ← active, highlighted
│ 💊 Здоровье  3  │
│ #  travel       │  ← no emoji → # symbol
│                 │
│ + New channel   │  ← dashed border
└─────────────────┘
```

**Desktop (>768px):**
- Sidebar always visible, 260px, `position: fixed`
- Content (header, posts, input) shifts right by 260px
- ☰ button in header is hidden — sidebar cannot be closed

**Mobile (≤768px):**
- Sidebar hidden, opened by `☰` button in header
- Slides in from the left with background dimming (overlay)
- Selecting a channel → sidebar closes automatically
- Header shows emoji and name of the current channel
- `×` button to close the sidebar

**Channel settings:**
- Active channel shows a `⋯` button (three dots)
- Click → dropdown menu: "Members", "Edit", "Delete"
- On mobile the menu appears as a bottom-sheet
- On desktop — dropdown to the right of the sidebar

**Difference from tags:** Tags remain a horizontal
strip of pill buttons in the header. Channels — a
vertical list in a separate panel. Visually
impossible to confuse.

- If there are no channels — empty screen with a "Create channel" button

### 3.3 Channel Creation — Emoji Picker (v4.0)

**Problem:** Users don't know where to find or how to input emoji.

**Solution:** Built-in palette of 64 emoji, organized by category:

| Category | Examples |
|-----------|---------|
| People and family | 👨‍👩‍👧 👶 🐶 🐱 |
| Activities | 💪 🏃 🧘 🚴 |
| Health and food | 💊 ❤️ 🥗 ☕ |
| Work and study | 💼 📚 💻 ✏️ |
| Home and household | 🏠 🛒 💰 📅 |
| Travel | ✈️ 🚗 🏖️ ⛰️ |
| Hobbies | 🎮 🎬 🎵 📷 |
| Miscellaneous | ⭐ 🔥 💡 📌 |

Grid of 8 columns, click = select (toggle), one
selected emoji is highlighted.

### 3.4 Time — pill on the timeline

Time is displayed as a "pill" to the left of the card.
A vertical timeline runs through the center of the
pills and ends at the day's date.

```
  09:30  ┌─────────────────────────┐
    │    │ Утренняя прогулка       │
    │    │ Описание...             │
    │    └─────────────────────────┘
  10:15  ┌─────────────────────────┐
    │    │ ┌───────┬───────┐       │  ← media-only: photo fills the block
    │    │ │ photo │ photo │       │
    │    │ └───────┴───────┘       │
    │    └─────────────────────────┘
```

### 3.5 Post Types by Content

Entries automatically receive a visual style
depending on their content:

| Type | Condition | Visual | CSS | Example |
|-----|---------|--------|-----|--------|
| **Compact** | Title only or text only, < 150 chars, no `\n` | No background, no card. Thin separator between entries. Lightweight, like a list item | `.event.compact` | "Took vitamin D #health" |
| **Full card** | Title + text, or long text, or code | Card with background, rounded corners, shadow. Title in a tinted header with accent border | `.event` | Walk report with description |
| **Single media** | Post with 1 photo/video | Card narrows to photo width (`fit-content`). Photo in natural proportions | `.event.single-media` | One photo from the park |
| **Media-only** | Only photos/videos, no text | No padding, media full width. Menu overlay on top of photo | `.event.media-only` | Photo album without caption |
| **Captioned media** | Title + photos, no text | Photo fills the card, title overlay at bottom with gradient | `.event.captioned-media` | "Sunset" + photo |
| **Title + text + media** | Title + text + photos | Card with header → text → media grid | `.event` | "Family dinner" + description + 3 photos |
| **Title + text + media** | Everything | Full card: header → text → media | `.event` | Full diary entry |

**Why compact has no background:**
- 80% of habit tracker entries are single-line
  ("Pills", "5 km run")
- Cards with background for each one create visual noise
- Without background, entries read like a list — quick to scan
- A thin `border-bottom` separator divides entries

**Why single-media is narrower:**
- A single photo should not stretch to the full feed
  width — it looks disproportionate
- `fit-content` + `max-width: 85%` — the card wraps
  around the photo (like in Telegram)
- On mobile — 100% width (screen is narrow)

**Auto-detect type (Feed.tsx):**
```
isCompact = (files.length === 0 && !text && title.length < 150 && !title.includes('\n'))
         || (files.length === 0 && !title && text.length < 150 && !text.includes('\n'))
isMediaOnly = !title && !text && files.length > 0
isSingleMedia = files.length === 1
```

### 3.6 Full-screen Media Viewer

**Lightbox:**
- Click on a photo/video in the grid → full-screen overlay
- Closing: × button, Escape, click on dark background,
  Back button (Android/browser) via
  `pushState` + `popstate`
- Navigation: `‹` `›` buttons (desktop), swipe (mobile), ← → keys
- Video: auto-play on open, native controls, `playsinline`
- Animations: slide-left / slide-right when navigating between files
- On navigation: video is paused; on close — reset
- On mobile, navigation buttons are hidden (swipe only)
- Download: ⬇ button downloads the original file
  to the user's device
- In the feed: 300px thumbnails (Pillow/OpenCV). In the lightbox: originals

### 3.7 Iconography

Header: SVG stroke-based 20×20, unified style.
Composer and menus: Unicode symbols.

| Element | Icon | Type |
|---------|--------|-----|
| Sidebar | SVG ≡ (3 lines) | Header |
| Tag filter | SVG (3 lines of decreasing width) | Header |
| Search | SVG (magnifying glass) | Header |
| Post menu | ⋮ | Unicode |
| Drag handle | ⋮⋮ | Unicode |
| Attach file | ⊕ File | Tool button |
| Description | Aa Text | Tool button |
| Date | ◷ Date | Tool button |
| Templates | ⚡ Template | Tool button |
| Send | ↑ | Send button |
| Edit | ✎ | Dropdown item |
| Delete | × | Dropdown item |

---

## 4. CSS Architecture

### 4.1 Variables (Design Tokens)

```css
--primary: #1e293b     /* Primary dark */
--accent: #ef233c      /* Accent — red for hashtags */
--bg: #f1f5f9          /* Background */
--card-bg: #ffffff     /* Cards */
--border: #e2e8f0      /* Borders */
--text-main: #334155   /* Primary text */
--text-muted: #94a3b8  /* Secondary text */
--shadow-sm/md/lg      /* Shadows — 3 levels */
--radius-sm/md/lg      /* Border radii — 8/16/24px */
--safe-*               /* Safe area insets for iPhone */
```

Dark mode via
`@media (prefers-color-scheme: dark)` — all
variables are overridden.

### 4.2 Responsive Strategy

| Breakpoint | Behavior |
|-----------|-----------|
| > 768px | Channel sidebar always visible, hover effects, desktop dropdown, lightbox buttons |
| ≤ 768px | Tablet: sidebar hidden (☰), bottom-sheet menu, compact spacing |
| ≤ 480px | Phone: button text hidden (icons only), smaller elements |

### 4.3 Accessibility (touch)

- Minimum tap target: 44×44px
- `@media (hover: none)` — hover effects disabled, drag-handle hidden
- Safe area insets for iPhone

---

## 5. Backend (FastAPI)

### 5.1 Architecture

```
Browser ──▶ api.ts ──▶ FastAPI ──▶ Filesystem
              │            │
         JWT token    /data/posts/{channel}/{post}/
         localStorage
```

### 5.2 Channels

**Routes:**
- `GET /api/channels` — list of channels with metadata and post counts
- `POST /api/channels` — create channel (slug validation, deny-list)
- `PUT /api/channels/{name}` — update displayName, emoji, description
- `DELETE /api/channels/{name}` — delete channel with all posts

**Slug validation:**
- Regex: `^[a-z][a-z0-9_]{2,31}$`
- Deny-list: `api`, `posts`, `admin`, `login`,
  `auth`, `settings`, `users`, `channels`, `new`,
  `create`, `delete`, `edit`, `search`, `help`,
  etc.

**Metadata** is stored in `_channel.json` inside the channel folder.

### 5.3 Posts (channel-scoped)

**Routes:**
- `GET /api/channels/{channel}/posts?limit=8&before=basename&search=query`
  — pagination + full-text search
- `POST /api/channels/{channel}/posts`
- `PUT /api/channels/{channel}/posts/{basename}`
- `DELETE /api/channels/{channel}/posts/{basename}`

**Media:**
- `GET /posts/{channel}/{basename}/{filename}`
  — with support for `?token=<jwt>`, `?w=300`
  (thumbnail)

### 5.4 Authorization (JWT)

1. Password is set via `ADMIN_PASSWORD`
   (required, `none` to disable)
2. `POST /api/login` verifies password → returns JWT (HS256, 365 days)
3. Token is stored in `localStorage` (browser) /
   `SharedPreferences` (Android)
4. All `/api/*` and `/posts/*` requests require
   `Authorization: Bearer <token>`
5. Media files alternatively accept
   `?token=<jwt>` (for `<img src>`, `<video src>`)

**Details:**
- `hmac.compare_digest` for constant-time password comparison
- `JWT_SECRET_KEY` — if not set, generated
  at startup (tokens won't survive a restart)
- Public paths without authorization: `/api/login`,
  `/api/auth/check`, frontend files
- On 401 the frontend clears the token and shows the login screen

### 5.5 Security

| Protection | Implementation |
|--------|-----------|
| Path traversal | `validate_path_component()` + `safe_resolve()` with POSTS_DIR boundary check |
| XSS | DOMPurify sanitization on the frontend |
| File attacks | Extension allowlist, 100MB/file limit, filename sanitization |
| Null-byte injection | `\0` filtering in filenames |
| CSRF | Bearer token instead of cookies |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| CORS | Configured via `CORS_ORIGINS` |

### 5.6 Environment Variables

| Variable | Default | Description |
|-----------|-------------|----------|
| `DATA_DIR` | `/data/posts` | Data storage directory |
| `FRONTEND_PATH` | `/app/frontend` | Frontend directory |
| `ADMIN_PASSWORD` | *(required)* | Password (`none` = auth disabled) |
| `ADMIN_USERNAME` | `owner` | Initial admin user name |
| `ALLOW_REGISTRATION` | `false` | Allow self-registration |
| `JWT_SECRET_KEY` | *(auto)* | JWT secret |
| `JWT_EXPIRY_DAYS` | `365` | Token lifetime |
| `CORS_ORIGINS` | `*` | CORS domains |

### 5.7 Windows-specific Notes

- `ConnectionResetError` during video streaming —
  harmless `ProactorEventLoop` noise, suppressed
  at the logging level
- Range requests (206 Partial Content) — normal
  behavior during video streaming

### 5.8 API Naming Convention

All API responses use **snake_case** for field
names — the same format used in Python code and
on-disk JSON storage. No conversion layer between
storage and API.

**Why snake_case everywhere:**

- Python is the primary language of the project —
  PEP 8 convention is snake_case
- On-disk storage (JSON files, YAML frontmatter)
  uses snake_case — API returns data as-is with
  zero transformation overhead
- No conversion layer means no bugs from missed
  field mappings, no `_safe_user()` / `_safe_invite()`
  translation functions
- One naming convention across the entire stack:
  disk → Python backend → API → frontend
- YAML frontmatter uses snake_case (`created_at`,
  `tags`) — Obsidian convention

**For mobile clients (future):**

Kotlin and Swift clients can remap snake_case to
camelCase at the JSON parser level in one line:

```kotlin
// Kotlin (Gson)
GsonBuilder().setFieldNamingPolicy(
    FieldNamingPolicy.LOWER_CASE_WITH_UNDERSCORES
).create()

// Kotlin (kotlinx.serialization)
Json { namingStrategy = JsonNamingStrategy.SnakeCase }
```

```swift
// Swift (Codable)
decoder.keyDecodingStrategy = .convertFromSnakeCase
```

This is a standard approach — most Python APIs
(Django REST, FastAPI defaults, Flask) return
snake_case, and mobile clients handle the mapping.
- **Line endings**: Python `write_text()`
  converts `\n` → `\r\n`. If text from the
  browser already contains `\r\n`, the result is
  `\r\r\n`. The backend normalizes `\r\n` → `\n`
  before writing in `generate_md()`

---

## 6. Video

### 6.1 Supported Formats

`.mp4`, `.mov`, `.webm`, `.avi`, `.mkv`, `.m4v`, `.3gp`

### 6.2 Display in Grid

- In the feed, video is displayed as a JPEG preview
  (frame at 1 second), not a `<video>` tag
- Semi-transparent `▶` badge centered on the preview
- Same dimensions and `object-fit: cover` as photos
- Preview is generated by the backend via OpenCV (see 6.4)

### 6.3 Lightbox

- On open: `<img>` is hidden, `<video controls playsinline>` is shown
- Autoplay: `video.play()` on open
- On navigation: `video.pause()`
- On close: `video.pause(); video.currentTime = 0`
- Slide animations work for the video element as well

### 6.4 Thumbnails

Lazy generation with caching in `.thumbs/` inside the post folder.

**Images** (Pillow): resize to 300px width,
JPEG quality 55, ~15-20KB.
**Video** (OpenCV): extract frame at 1 second
(or 10% of duration), resize, JPEG.

```
20260320_101500_progulka/
  park.jpg              ← original 4MB
  video.mp4             ← original 15MB
  .thumbs/
    park_300.jpg         ← thumbnail 15KB (lazy, on first request)
    video_300.jpg        ← poster frame 20KB
```

| Parameter | Value | Reason |
|----------|----------|---------|
| Width | 300px | Sufficient for the grid, saves bandwidth |
| Quality | 55 | Balance: visually acceptable, ~15KB |
| Format | JPEG | Universal, small size |
| Cache | `.thumbs/` in post folder | Travels with the post on rename |
| Invalidation | By `st_mtime` | If original is updated — regenerated |
| API | `?w=300` on media URL | Backend serves thumbnail or generates it |

**Why `.thumbs/` in the post folder, not a global cache:**
- On post rename (reorder) the cache travels with it — no invalidation needed
- On post deletion `shutil.rmtree` removes everything automatically
- Obsidian hides dot-prefixed folders

**Dependencies:** Pillow (images), opencv-python-headless (video).

---

## 7. Dependencies

### Frontend (npm)

| Library | Purpose |
|-----------|-----------|
| React 19 | UI framework |
| Zustand 5 | State management with persist |
| react-router-dom 7 | Client-side routing |
| Vite 6 | Build tool, dev server, HMR |
| marked | Markdown → HTML |
| DOMPurify | XSS sanitization |
| highlight.js | Code syntax highlighting |
| JSZip | ZIP export of Obsidian Vault |
| i18next + react-i18next | Internationalization (RU/EN) |
| i18next-browser-languagedetector | Browser language auto-detection |

### Backend (pip)

| Library | Purpose |
|-----------|-----------|
| FastAPI | HTTP framework |
| uvicorn | ASGI server |
| PyJWT | JWT tokens |
| bcrypt | Password hashing (multi-user) |
| Pillow | Image thumbnail generation |
| opencv-python-headless | Video frame extraction for previews |

---

## 7.1 Pagination (v6.0)

Inverted loading — messenger-style.
The latest entries are visible immediately, older
ones load on scroll up.

**API:** `GET /api/channels/{ch}/posts?limit=8&before=basename`
- `limit=8` — latest ~8 posts
- `before=basename` — cursor: posts older than the specified one
- Backend pads to a full day: if the 8th post is
  from day X — all posts from day X are included
- Without parameters — all posts (for export)

**Frontend:**
- Initial load: `limit=8`, scroll to bottom (latest entries)
- Scroll up (scrollTop < 100px) → load next batch
  `limit=8, before=firstPost`
- 1.5 sec cooldown after loading — prevents cascading loads
- Deduplication on prepend (by basename)
- After CRUD: reload with `limit=N` (N = current post count)
- `hasMorePosts` — false when there are no older posts left

## 7.2 Search and Filters (v7.1)

**Search:** SVG icon (magnifying glass) in header.
On click, an input field expands below the header.
Server-side full-text search:
`GET /api/channels/{ch}/posts?search=query`
(debounce 300ms). On empty query and blur —
collapses.

**Tag filter:** SVG icon (3 lines) in header →
dropdown via Portal into `document.body`. List of
hashtags from all loaded posts (title + text).
Backdrop for closing.

**Active filter:** pill badge in header (`#health ×`), click = reset.

Search and filter can be combined (both apply).
Reset on channel switch.

## 7.3 Interactive Checkboxes (v6.0)

Markdown `- [ ]` / `- [x]` render as clickable checkboxes.

- Marked generates
  `<input disabled type="checkbox">` — the backend
  removes `disabled`, adds `data-check-idx`
- Click toggles `[ ]` ↔ `[x]` in the post text and saves to the backend
- Optimistic update: UI updates instantly, API call is async
- Completed tasks: strikethrough text + muted color

## 7.4 Adaptive Card Sizes (v7.1)

Card width depends on content (desktop):

| Post type | Width | Photo | Style |
|-----------|--------|------|-------|
| Compact | 100% | — | No card, line with separator |
| Media-only, 1 photo | `fit-content`, max 85% | Natural proportions, `contain` | Card shrinks to photo |
| Captioned media | 100% | `cover`, full width | Frosted glass pill with title |
| Title + text + 1 photo | 100% | `cover`, full width | Photo stretches to card |
| Media-only, 2+ photos | 100% | Grid layout | Grid |
| Full card | 100% | — | Standard card |

On mobile — all cards are 100% width.

**Key rule:** `fit-content` only for
`media-only.single-media` (one photo without text).
If there is text — card is full width, photo uses
`object-fit: cover`. Otherwise text gets clipped by
a narrow photo.

**Captioned media (title + photo without text):**
- Uses the same silver frosted glass header
  as full cards (unified style)
- Media edge-to-edge, `margin-top: -10px` (overlaps header)
- event-body without background/border — only header + media
- Long title: `-webkit-line-clamp: 2` (clipped to 2 lines)
- Typography: 13.5px/500,
  `letter-spacing: -0.008em`,
  `-webkit-font-smoothing: antialiased`

## 7.5 Quick Input Templates (v7.0)

Saved phrases for recurring entries —
per-channel, synced via server.

**Storage:** `_templates.json` in the channel folder.
Copied along with the channel on backup.

```json
["Витамин D #здоровье", "Пробежка _ км #спорт", "Выпил таблетки #таблетки"]
```

**API:**
- `GET /api/channels/{ch}/templates` → `string[]`
- `PUT /api/channels/{ch}/templates` ← `string[]`
  (max 50 templates, 200 characters)

**UI:** `⚡ Template` button in Composer toolbar →
popup with list. Click = insert into title.
If the title has text — a `+ Save` button appears
at the bottom of the popup. Delete — `×` on each
template.

**Why on the server, not in localStorage:**
sync between devices (phone ↔ PC).
Templates for #health are different from
#travel (per-channel).

## 7.6 Media Grid (v7.0)

Adaptive grid layout for photos/videos in a post:

| Count | Grid | Proportions |
|-----------|-------|-----------|
| 1 | Single photo | 3:2, fit-content width |
| 2 | `[■] [■]` | 1:1 (squares) |
| 3 | `[═══════]` / `[■] [■]` | First 2:1 (banner), two 1:1 |
| 4 | `[■] [■]` / `[■] [■]` | All 1:1 |
| 5 | `[═══════]` / `[■] [■]` / `[■] [■]` | First 2:1, four 1:1 |
| 6+ | `[■] [■] [■]` / `[■] [■] [■]` | All 1:1, 3 columns |

**Why:** no empty squares,
Telegram-style approach. `object-fit: cover` crops
the excess.

## 7.7 Sticky Day Headers (v7.0)

The day's date sticks to the top of the screen on
scroll — always visible which day is being viewed.

- `position: sticky; top: 0` on `.day-header`
- Pill style with `backdrop-filter: blur`
- Each header pushes the previous one out (native CSS behavior)

## 7.8 Link Styling (v7.0)

Links in post titles and text:
`color: var(--accent)`, background highlight
`color-mix(accent 8%)`, `border-radius: 3px`.
Hover intensifies the background. `word-break: break-all`
for long URLs.

## 7.9 DatePicker (v7.0)

Two modes depending on device:

**Desktop (flatpickr):** custom calendar + time with
OK button. Dark theme via CSS variables.
Mouse wheel on days/months/year/hours/minutes.
+/− buttons for time. `fp.close` is blocked —
closing only via OK or click outside.

**Mobile (native):**
`<input type="datetime-local">` → system picker
iOS/Android. `blur` event with 3-second timeout
(Android blur fires when the picker opens).

**Why two approaches:** `showPicker()` is unreliable,
the native picker on desktop is ugly, flatpickr on
mobile conflicts with touch.

## 7.10 Composer Layout (v7.0)

```
┌──────────────────────────────────────┐
│  Title, #tags...                 [↑] │  ← pill with border-radius: 22px
└──────────────────────────────────────┘
  ⊕ File   Aa Text   ◷ Date   ⚡ Template
┌──────────────────────────────────────┐
│  Details (Markdown)...               │  ← if Aa is active
└──────────────────────────────────────┘
```

Title + send in one pill. Tools below it.
Textarea expands below. Title limit:
80 characters, counter appears after 60.

**Clipboard paste:**
Images can be pasted via Ctrl+V / Cmd+V
directly into the composer form. Screenshots,
copied images from browsers and messengers are
supported. Implementation: React `onPaste` on
`<form>` → `clipboardData.files` → added to preview.
Standard pattern (Slack, Discord, Notion).

---

## 8. Multi-user Mode (v5.0)

### 8.1 Multi-user Only

Password-only login mode (without username) is **intentionally absent**.

**Reasons:**
- Family journal — each family member wants their own channels and notes
- Post authorship is impossible without username
- Private channels are impossible without users
- Single code path — no `if singleUser` in every
  endpoint, middleware, component. For example:
  admin panel doesn't check "are there any users
  at all?", post filtering doesn't branch on
  "show all vs check roles", login form always
  has two fields
- First launch: `ADMIN_PASSWORD=xxx` creates
  admin automatically — no harder than entering a password

### 8.2 Data Storage (User Store Adapter)

Adapter pattern: abstract `UserStore` interface
+ `JsonFileUserStore` implementation.
Can be replaced with PostgreSQL/SQLite via a subclass without touching the rest of the code.

```
backend/users.py
  ├── UserStore (ABC)          — interface: users, members, invites
  └── JsonFileUserStore        — JSON files with file locking

/data/
  _users.json                  — [{id, username, display_name, password_hash, is_admin, created_at}]
  _members.json                — [{channel_name, user_id, role, joined_at}]
  _invites.json                — [{token, channel_name, role, created_by, expires_at, ...}]
```

**File locks**: all writes use an exclusive file
lock (`fcntl` on Unix, `msvcrt` on Windows) with a
5 sec timeout. If the lock cannot be acquired — an
explicit `TimeoutError`, not silent data loss.

**Write atomicity**: write-to-temp → fsync →
rename. On the same filesystem, rename is atomic.

### 8.3 Roles and Permissions

| Action | Public (anon) | Viewer | Editor | Owner/Admin |
|----------|:---:|:---:|:---:|:---:|
| See channel in list | Yes | Yes | Yes | Yes |
| Read posts | Yes | Yes | Yes | Yes |
| See hidden posts | — | — | Own | All |
| Create posts | — | — | Yes | Yes |
| Edit own | — | — | Yes | Yes |
| Edit others' | — | — | — | Yes |
| Delete own | — | — | Yes | Yes |
| Delete others' | — | — | — | Yes |
| Manage members | — | — | — | Yes |
| Create invites | — | — | — | Yes |

### 8.4 Channel Visibility

`visibility` is added to `_channel.json`:

```json
{
  "name": "family",
  "visibility": "private",
  ...
}
```

- **public**: anyone (even unauthenticated)
  can read posts via
  `/api/public/{channel}/posts`
- **private**: only channel members can see and read

### 8.5 Hidden Posts

In post YAML frontmatter: `hidden: true`. Hidden
posts are visible only to the author and the channel owner/admin.

### 8.6 Invite System

1. Channel owner creates an invite:
   `POST /api/channels/{ch}/invite` →
   `{token, ...}`
2. A link is formed: `https://example.com/invite/{token}`
3. Recipient opens the link → sees channel information
4. If already authenticated → joins immediately
5. If not — registers and joins in one step

Invites have: `max_uses`, `expires_at`, `use_count`.

### 8.7 First Launch

On first launch (no users):
1. If `ADMIN_PASSWORD` is set — an admin user
   is created
   (name = `ADMIN_USERNAME` or `owner`)
2. If not set — the first registered user
   receives admin rights
3. Admin has access to all channels

### 8.8 Admin Panel (v5.0)

Available only to users with the `is_admin` flag.
Opened via the `/c/_admin` route through the
"⚙ Admin" button at the bottom of the sidebar.

**Contents:**
- **Statistics** — number of users, channels,
  posts, data volume (4-cell grid)
- **Settings** — "Open registration" toggle (on/off at runtime)
- **User list** — name, @username,
  role, delete button (cannot delete yourself)
- **Add user** — form: username, display name, password

**Registration control:**
- `ALLOW_REGISTRATION=false` (default) —
  registration is closed, only admin creates users
- Admin can toggle at runtime from the panel
- If disabled — the "Register" button is not shown on the login screen
- The first user can always register (even if disabled)

### 8.9 New API Endpoints (multi-user)

```
POST   /api/register              {username, password, displayName}
POST   /api/login                 {username, password}  ← now with username
GET    /api/me                    → current user
GET    /api/users                 → all users (admin)
GET    /api/channels/{ch}/members → channel members
POST   /api/channels/{ch}/members {userId, role}
DELETE /api/channels/{ch}/members/{userId}
POST   /api/channels/{ch}/invite  {role, maxUses, expiresInDays}
GET    /api/channels/{ch}/invites → invite list
GET    /api/invite/{token}        → invite info (public)
POST   /api/invite/{token}/accept {username?, password?}
DELETE /api/invites/{token}
GET    /api/public/{channel}/posts → read public channel without auth

# Admin panel (admin only)
GET    /api/admin/settings        → {open_registration: bool}
PUT    /api/admin/settings        {open_registration: bool}
POST   /api/admin/users           {username, password, displayName, is_admin}
DELETE /api/admin/users/{userId}
GET    /api/admin/stats           → {users, channels, posts, storageBytes}
```

### 8.10 Environment Variables (new)

| Variable | Default | Description |
|-----------|-------------|----------|
| `ADMIN_USERNAME` | `owner` | Initial admin user name |
| `ALLOW_REGISTRATION` | `false` | Allow self-registration |

---

## 9. Known Limitations

| Limitation | Reason | Workaround |
|-------------|---------|---------------|
| JSON files for users | Simplicity, zero dependencies | Replace with PostgreSQL via UserStore adapter |
| Drag & drop on mobile | Solved: pointer events + long-press 500ms + haptic | — |
| No HTTPS | FastAPI without TLS | Reverse proxy (nginx/caddy/Cloudflare) |
| Token in media URL | `<img>`, `<video>` don't send headers | `?token=` query parameter |
| Channel address is immutable | Used in on-disk paths | Delete and recreate |
| File lock on Windows | `msvcrt.locking` locks 1 byte | Sufficient for write serialization |

---

## 10. Roadmap

- [x] **FastAPI Backend** — REST API, file-based storage
- [x] **Docker** — one-command deploy, non-root, healthcheck
- [x] **Auto-detect** — single frontend for both modes
- [x] **Video** — upload, display, playback
- [x] **Lightbox** — full-screen viewer with navigation and swipe
- [x] **JWT Authorization** — password + long-lived token
- [x] **Security** — path traversal, XSS,
  input validation, security headers
- [x] **Dark mode** — automatic via `prefers-color-scheme`
- [x] **Channels** — multi-channel organization with clean URLs
- [x] **Data adapter** — MockAdapter / HttpAdapter in a single api.ts
- [x] **Emoji Picker** — built-in palette for channels
- [x] **Multi-user** — accounts,
  roles, invites, hidden posts, storage adapter
- [x] **Channel sidebar** — vertical list
  instead of horizontal tabs, Telegram-style
- [x] **Admin panel** — users, statistics,
  API keys, backup, import, profile
- [x] **Full-text search** — server-side search
  across all posts, debounce 300ms
- [x] **Pagination** — inverted loading, flushSync for smoothness
- [x] **Thumbnails** — lazy photo thumbnails
  (Pillow) + video posters (OpenCV) in `.thumbs/`
- [x] **Drag & Drop** — pointer events,
  long-press (mobile), auto-scroll, creating
  new days
- [x] **Checkboxes** — `- [ ]`/`- [x]` clickable, optimistic update
- [x] **Card types** —
  compact/full/captioned-media/media-only/single-media,
  adaptive width
- [x] **Code highlighting** — highlight.js, copy button
- [x] **File attachments** — PDF, DOCX, ZIP, etc., colored chips by type
- [x] **Templates** — per-channel, server-side sync
- [x] **DatePicker** — flatpickr (desktop) + native (mobile)
- [x] **Telegram import** — CLI + Web UI
- [x] **Backup** — ZIP archives from admin panel
- [x] **External API** — API keys, post creation, backup
- [x] **Draft auto-save** — per-channel, localStorage
- [x] **User profile** — change username, password, displayName
- [x] **Clipboard paste** — paste images
  from clipboard (Ctrl+V / Cmd+V) into composer
- [ ] **PWA Offline** — service worker, caching
- [ ] **Push notifications** — habit reminders
- [ ] **Habit statistics** — streaks by hashtag
- [ ] **Sync** — conflict-resilient sync with Obsidian
