# Milagram — Family Photo Album and Diary

A self-hosted app with a messenger-style interface. It looks like a chat,
but it's a full-featured photo album + diary + tracker. Your data lives on
your own disk in simple folders and plain text files. Works on desktop,
tablet, and phone — responsive interface with touch gestures and automatic
dark mode.

## Why

The main goal is convenient, structured storage for family photos and
videos. Not dumped into one folder, but organized by channels and dates,
with captions, hashtags, and fast search. Photos stay on your server in
original quality — not compressed on someone else's — and an export looks
like a tidy archive, not a mess of thousands of files.

And since there's already a feed with entries and media, it turned out to
be handy for journaling, habit tracking, jotting down ideas, and even the
occasional family message. Similar functionality, one interface.

---

## What it's good for

### Photo album (primary use)

Photos and videos are uploaded to the feed and stored on disk in folders —
organized, not dumped. The feed shows thumbnails (so you don't load
gigabytes of originals), while the full-screen lightbox serves originals
with swipe and arrow-key navigation.

### Diary

Markdown with headings, lists, syntax-highlighted code, and attachments.
Each entry is a separate folder where you can attach photos, videos, PDFs,
DOCX files. The feed looks like a chat — writing is as quick as sending a
message.

### Habit tracker and log

"Took vitamin D #health", "5 km run #fitness" — entries like these display
compactly, without a card, as lines in a list. For recurring ones, use
templates: one click and the entry is ready. Hashtags + filtering let you
pull up history fast.

### Tasks and ideas

Interactive checkboxes (`- [ ]` / `- [x]`) — clickable right in the feed.
Short ideas are easy to jot down as tagged notes. Full-text server-side
search across all entries in a channel.

### Occasional messages

Can be used as a family messenger for infrequent messages. But each
message = a separate folder on disk, so it's not suited for active
conversations. For "look at this sunset" or "doctor's appointment tomorrow
at 10:00" — it's perfect.

---

## How it differs from alternatives

### Problems with Google Photos

- On export — all files land in one folder, a jumble of IMG_0001–IMG_9999
  with no structure
- Can't attach a text note or caption to a group of photos
- Data lives on someone else's servers — Google can change terms, delete
  your account, or shut down the service at any time
- No channels or sections — everything in one endless feed

### Problems with Telegram

- Limit of 10 photos/videos per message
- Can't reorder entries after posting
- Can't backdate an entry
- Can't add media to an existing post after the fact — forgot to attach a
  photo, and that's it, you have to send a new message
- Photos are compressed on regular send. You can send as a "file" —
  quality is preserved, but the photo stops displaying as a post with a
  swipeable gallery and shows up as a downloadable document instead
- Data lives on Telegram's servers

### What Milagram offers

- Files are organized in folders with meaningful names — export = copy the
  folder
- Every entry has a Markdown note attached
- No limit on the number of photos per post
- Drag & Drop — reorder entries however you like
- Backdate entries, move them between days
- Add and remove media from existing entries at any time
- Photos and videos are stored in original quality — no compression, and
  you still get a proper swipeable gallery
- Data on your disk, in plain files, no vendor lock-in

---

## Users and privacy

Milagram is designed for a family or a small group of friends. Everyone
gets their own account with a username and password. Channels are private
by default: only the creator can see them. To share a channel, create an
invite link and send it to the right person. Until they're invited, nobody
sees anyone else's posts.

This is convenient: you can keep a personal diary in a private channel and
the family photo album in a shared one. Mom has her recipe channel, Dad
has his work notes, and "Trips" is shared with the whole family.

Roles: **owner** (full control over the channel), **editor** (create and
edit posts), **viewer** (read-only). Admin panel for managing users,
statistics, API keys, and backups.

---

## Features

**Content and media:**
- Channels — organize entries by topic (family, health, travel)
- Photos and videos — upload, paste from clipboard
  (Ctrl+V / Cmd+V), server-side thumbnails, lightbox
  with navigation, swipe, and original download
- File attachments — PDF, DOCX, ZIP, and more with color-coded chips by
  file type
- Markdown — headings, lists, syntax-highlighted code with a copy button
- Interactive checkboxes — `- [ ]` / `- [x]` clickable right in the feed

**Organization and navigation:**
- Drag & Drop — reorder entries and move them between days (desktop +
  mobile)
- Backdating via DatePicker (flatpickr on desktop, native on mobile)
- Hashtags — filter the feed by tags, click a tag in text
- Full-text server-side search across all entries in a channel
- Inverted pagination — loads like a messenger, latest entries at the
  bottom

**Input convenience:**
- Templates — saved phrases for recurring entries, per-channel
- Draft auto-save — per-channel, survives page reloads

**Platform:**
- Multi-user — accounts, roles (owner/editor/viewer), invite links
- Private channels — visible only to members
- Telegram import — migrate history via CLI or web interface
- Backups — ZIP archives from the admin panel
- External API — API keys for automation (creating posts, backups)
- Multilingual — Russian and English, switchable in the sidebar
- Dark mode — automatic via `prefers-color-scheme`
- PWA — install to home screen from Chrome

---

## What it looks like

Apple-style interface: frosted glass (semi-transparent headers with
background blur), smooth animations, minimal shadows. Entries
automatically get a visual style based on their content:

- **Compact** — short entry without photos displays as a line, no card
- **Full card** — heading + text + media in a card with a glass header
- **Media-only** — photos only, no padding, full width
- **Captioned media** — heading in frosted glass over the photo
- **Single media** — a single photo narrows the card to its proportions

Dark mode activates automatically based on system settings. All colors
use CSS custom properties — switching is instant, no reload needed.

---

## Philosophy: your files are your data

Milagram doesn't convert, compress, or hide your data in a database.
Everything is stored as plain files on disk:

- **Notes** — regular `.md` files (Markdown with YAML frontmatter)
- **Photos and videos** — originals, unmodified, exactly as uploaded
- **Structure** — each entry in its own folder, channels = top-level
  folders

```
posts/
├── family/                              ← "Family" channel
│   ├── 20260320_083000_progulka/        ← entry
│   │   ├── 20260320_083000_progulka.md  ← text (Markdown)
│   │   ├── park1.jpg                    ← photo — original
│   │   ├── park2.jpg
│   │   └── video.mp4                    ← video — original
│   └── 20260321_190000_uzhyn/
│       ├── 20260321_190000_uzhyn.md
│       └── IMG_4521.jpg
└── health/                              ← "Health" channel
    └── ...
```

This is the same philosophy as [Obsidian](https://obsidian.md): no
proprietary database, no vendor lock-in. You can open the folder in
Obsidian as a Vault, copy it to a flash drive, sync via Syncthing, or
simply browse it in your file manager. The app is just a nice interface
on top of the file system.

---

## Why every post is a folder

> This section is a deep dive into the storage format research. If you're
> not interested in the technical details, feel free to skip it — it
> doesn't affect how you use the app.

We tried a ton of storage and note-to-file binding approaches:

- **EXIF comments** — only work for photos (JPEG, TIFF). Videos, PDFs,
  ZIPs have no standard notes field. Not universal.
- **XMP sidecar files** (`.xmp` next to each file) — Adobe's standard,
  supported in Lightroom/Bridge. But one `.xmp` per file — and we need
  one note for a *group* of files. Plus the format is XML, awkward to
  read and edit by hand.
- **One big `.md` per channel** — quickly becomes a huge file, conflicts
  during concurrent edits, unclear where to store media.
- **Database (SQLite/Postgres)** — vendor lock-in, can't open in
  Obsidian, can't copy a folder and get a working archive.
- **Separate `.md` files without folders** — where do you put the media?
  If in a shared folder, the link between a note and its files is lost.
- **YAML index** — a separate registry file with media references. Breaks
  when files are renamed, requires synchronization.

A separate issue with EXIF — even if limited to photos only:

- Different tools read and write EXIF differently. For example, Windows
  writes not just one field when editing a file comment, but a bunch of
  them at once (XPComment, UserComment, ImageDescription) — and other
  viewers then read the wrong field and show nothing or garbage. Nextcloud
  Memories, for instance, may not see a comment written via Windows.
- Google Photos, Mega, and other cloud services let you write comments on
  photos, but store them in their own database, not in EXIF. On export,
  those comments are lost entirely. Most likely this is done for privacy:
  if you create a link to an album, your personal captions shouldn't leak
  to some stranger who opens the photo.

What mattered to us was different — making the archive as durable as
possible. So it just opens from disk on any OS, without special software.
So a backup is simply copying a folder, and restoring is copying it back.

In the end, a folder per post turned out to be the only truly workable
solution — even if not the most intuitive at first glance. The key idea:
a folder is a maximally self-contained storage unit. One folder = one
`.md` note + all its files alongside it. Everything it needs travels with
it — nothing references the outside, nothing is stored in a shared pile.
You can take any folder, copy it anywhere, and it remains fully functional
without the rest of the archive for context.

Bonuses:

- When renaming a post (drag & drop changes order via the timestamp in the
  folder name), all files move together
- When deleting — `rm -rf` one folder, nothing is orphaned
- When backing up — `cp -r`, you get a complete working copy
- Thumbnail cache in `.thumbs/` inside the folder — travels with the
  post, gets deleted with the post

---

## Quick start

### Docker (recommended)

```bash
git clone <repo-url> milagram
cd milagram
cp .env.example .env        # set ADMIN_PASSWORD
docker compose up -d --build
```

Open `http://localhost:8000`. Login: username `owner` (or from
`ADMIN_USERNAME`), password from `ADMIN_PASSWORD`. More on production
deployment (HTTPS, backups, security) in
[`docs/DEPLOY.md`](docs/DEPLOY.md).

### Local development

```bash
# Terminal 1 — backend
pip install -r backend/requirements.txt
ADMIN_PASSWORD=mypass DATA_DIR=./posts \
  uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api/*` and `/posts/*` to the
backend.

**Windows:** see [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) —
instructions for CMD and PowerShell.

### Demo mode (no backend)

```bash
cd frontend && npm install && npm run dev
```

The frontend will detect the missing backend (2s timeout) and show in-
memory demo data.

---

## Environment variables

| Variable | Default | Description |
|-----------|-----------|----------|
| `ADMIN_PASSWORD` | — | **Required.** Admin user password (min. 4 characters) |
| `JWT_SECRET_KEY` | *(random)* | **For production.** Without it, tokens reset on restart |
| `ADMIN_USERNAME` | `owner` | Initial admin username |
| `DATA_DIR` | `/data/posts` | Data storage directory |
| `ALLOW_REGISTRATION` | `false` | Allow self-registration |
| `JWT_EXPIRY_DAYS` | `365` | Token lifetime in days |
| `CORS_ORIGINS` | `*` | Allowed origins (comma-separated). For production — your domain |
| `FRONTEND_PATH` | `/app/frontend` | Path to static files (Docker only) |

Files: `.env.example` (template, in git) → `.env` (actual values, in
.gitignore).

---

## Project structure

```
milagram/
├── frontend/                    # React 19 + TypeScript + Vite 6
│   └── src/
│       ├── App.tsx              # Router, Sidebar, Header
│       ├── Feed.tsx             # Feed, drag-and-drop, pagination, search
│       ├── Composer.tsx         # Input form, DatePicker, templates
│       ├── Lightbox.tsx         # Full-screen media viewer (zoom, swipe)
│       ├── Panels.tsx           # ProfilePage, AdminPanel, MembersPanel
│       ├── Auth.tsx             # Login, Register, Invite
│       ├── api.ts               # HttpAdapter, MockAdapter, auth, upload
│       ├── store.ts             # Zustand state + persist
│       ├── utils.ts             # Markdown, dates, transliterate, highlight.js
│       ├── i18n.ts              # Internationalization (RU/EN translations)
│       └── styles/app.css       # All styles (~4000 lines, dark mode)
├── backend/                     # FastAPI (modular architecture)
│   ├── main.py                  # Entry point (module imports)
│   ├── config.py                # Env vars, constants, app init
│   ├── auth.py                  # JWT, middleware, login/register
│   ├── helpers.py               # Validation, transliteration, markdown
│   ├── routes.py                # API routes (posts, media, backup, import)
│   ├── multi_user.py            # Users, members, invites, admin panel
│   └── users.py                 # UserStore adapter (JSON + file locking)
├── tools/
│   └── import_telegram.py       # CLI Telegram import
├── docs/                        # Detailed documentation
│   ├── DEPLOY.md                # Production deployment, HTTPS, backups
│   ├── DESIGN.md                # Architecture, API, design decisions
│   ├── INTERACTION_SPEC.md      # Micro-interactions (DnD, animations)
│   ├── DEVELOPMENT.md           # Developer guide
│   └── TESTING.md               # Tests
├── Dockerfile                   # Multi-stage build (Node.js → Python)
├── docker-compose.yml
└── .env.example
```

---

## Documentation

| Document | Contents |
|----------|-----------|
| [DEPLOY.md](docs/DEPLOY.md) | Production deployment, HTTPS, backups, checklist, troubleshooting |
| [DESIGN.md](docs/DESIGN.md) | Architecture, UX decisions, API spec, CSS, security |
| [INTERACTION_SPEC.md](docs/INTERACTION_SPEC.md) | Drag & drop, animations, gestures, DatePicker |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development, commands, cleanup, debugging |
| [TESTING.md](docs/TESTING.md) | 49 pure-function tests (normalize, validate, build) |
| [IDEAS.md](docs/IDEAS.md) | Plans: cloud sync, cloud-only storage, blog |

---

## Tech stack

| Layer | Stack |
|------|------|
| Frontend | React 19, TypeScript, Vite 6, Zustand 5, react-router-dom 7, i18next |
| Rendering | marked (Markdown), highlight.js (code), DOMPurify (XSS), JSZip (export) |
| Styling | CSS Custom Properties, Apple frosted glass, automatic dark mode |
| Backend | Python 3.12, FastAPI, uvicorn, PyJWT, bcrypt |
| Media | Pillow (image thumbnails), OpenCV (video poster frames) |
| Deployment | Docker multi-stage build (Node.js 20 → Python 3.12-slim) |
| Storage | File system — Obsidian-compatible `.md` + original media |

---

## License

MIT
