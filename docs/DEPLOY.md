# Milagram — Production Deployment

**Version:** 1.0
**Date:** 2026-03-25

Step-by-step guide for deploying Milagram on a server
with Docker.

---

## 1. Clone

```bash
$ git clone https://github.com/milagram/app '/opt/milagram/'
$ cd /opt/milagram
```

## 2. Prepare `.env`

```bash
$ cp .env.example .env
```

Required variables:

```env
# Admin user password (minimum 4 characters)
ADMIN_PASSWORD=strong-password-here

# Secret for signing JWT tokens.
# WITHOUT THIS: tokens are generated with a random key
# on every container restart, and all users will be
# logged out. To generate:
#   python3 -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET_KEY=paste-64-char-hex-here
```

Other variables are optional — see the
[table in README](../README.md#environment-variables).

---

## 3. Start

```bash
$ docker compose up -d --build
```

What happens:

- The Docker image is built (Node.js builds the frontend,
  Python runs the backend)
- Data is stored in the Docker volume `milagram-data`
  (survives restarts and container rebuilds)
- The container listens on port `8000`
- Built-in healthcheck monitors `/api/auth/check`
- Memory limit: 512 MB
- Log rotation enabled (10 MB × 3 files)
- Automatic restart on crash (`unless-stopped`)

---

## 4. First Login

Open `http://your-server:8000`. Log in with username
`owner` (or the value from `ADMIN_USERNAME`), password
from `ADMIN_PASSWORD`.

After logging in:

- Create channels (family, travel, health...)
- Invite family members via invite links
  (channel menu → Members → Create link)
- Start uploading photos

---

## 5. HTTPS (required for internet access)

Milagram does not include TLS — a reverse proxy is
needed. The simplest option is
[Caddy](https://caddyserver.com):

```
milagram.example.com {
    reverse_proxy localhost:8000
}
```

Caddy will automatically obtain a Let's Encrypt
certificate. Alternatives: nginx + certbot, Cloudflare
Tunnel, Traefik.

After setting up HTTPS, specify the domain in `.env`:

```env
CORS_ORIGINS=https://milagram.example.com
```

> **Without HTTPS**: passwords and tokens are transmitted
> in plain text. This is acceptable on a local network
> (at home), but not over the internet.

---

## 6. Data on Host Disk (optional)

By default, data is stored in a Docker volume. To store
it on the host disk (convenient for backups and
Obsidian sync), create a file:

```yaml
# docker-compose.override.yml
services:
  milagram:
    volumes:
      - ./data:/data/posts    # ← folder on your disk
```

Docker Compose will automatically pick up the override
file on the next `docker compose up`.

Permissions: the container runs as user `milagram`
(you can check the UID via
`docker exec milagram id`). The host folder must be
writable by this UID.

---

## 7. Backups

Four methods:

- **Via admin panel**: Admin → Backup → ZIP archives
  with download option
- **Via API**:
  ```bash
  curl -X POST http://localhost:8000/api/ext/backup \
    -H "X-API-Key: sk-..."
  ```
- **Manually**: copy the `data/` folder
  (or the Docker volume via `docker cp`)
- **Restore**: copy the folder back, restart the
  container

The API key is created in the admin panel. API backup
is convenient to schedule via cron:

```bash
# Daily backup at 3:00 AM
0 3 * * * curl -sX POST http://localhost:8000/api/ext/backup \
  -H "X-API-Key: sk-..." >> /var/log/milagram-backup.log
```

---

## 8. Updating

```bash
cd milagram
git pull
docker compose up -d --build
```

Data in the volume is not affected. JWT tokens remain
valid as long as `JWT_SECRET_KEY` has not changed.

---

## 9. Useful Commands

```bash
# Logs
docker compose logs -f

# Status
docker compose ps

# Stop
docker compose down

# Stop and remove volume (DELETES ALL DATA)
docker compose down -v

# Enter the container
docker exec -it milagram-milagram-1 bash

# Data size
docker exec milagram-milagram-1 du -sh /data/posts
```

---

## Pre-Launch Checklist

- [ ] `ADMIN_PASSWORD` — a strong password is set
- [ ] `JWT_SECRET_KEY` — generated and saved
- [ ] `.env` added to `.gitignore` (do not commit passwords)
- [ ] HTTPS configured (if accessible from the internet)
- [ ] `CORS_ORIGINS` — your domain is specified (not `*`)
- [ ] Backups configured (cron or manual)
- [ ] Port 8000 is not exposed to the internet directly
  (only through reverse proxy)

---

## Troubleshooting

### Container does not start

```bash
docker compose logs milagram
```

Common causes:
- `ADMIN_PASSWORD` not set → backend starts, but login
  is not possible
- Port 8000 is occupied by another process

### Everyone logged out after restart

`JWT_SECRET_KEY` is not set in `.env`. Without it, the
key is regenerated on every start. Set it and restart —
users will need to log in once.

### Photos fail to upload

- Check available disk space: `df -h`
- File size limit: 100 MB
- Supported formats: jpg, png, gif, webp, heic,
  mp4, mov, webm and others (see DESIGN.md)

### Cannot access data on host disk

Check permissions:
```bash
# Find the container user's UID
docker exec milagram-milagram-1 id
# Grant permissions on the folder
sudo chown -R <uid>:<uid> ./data
```
