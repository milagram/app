# Milagram — Production Deployment

**Version:** 1.1
**Date:** 2026-03-27

Step-by-step guide for deploying Milagram on a server
with Docker.

---

## 0. Prerequisites

```bash
apt install git
curl -fsSL https://get.docker.com | sh
```

## 1. Clone

```bash
git clone https://github.com/milagram/app /opt/milagram
cd /opt/milagram
```

## 2. Prepare `.env`

```bash
cp .env.example .env
nano .env
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
docker compose up -d --build
```

What happens:

- The Docker image is built (Node.js builds the frontend,
  Python runs the backend)
- Data is stored in `./data/` on the host disk
  (survives restarts and container rebuilds)
- The container listens on port `8000`
- Built-in healthcheck monitors `/api/server/ping`
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

## 6. Data Storage

By default, data is stored in `./data/` next to
docker-compose.yml (bind mount). This means your photos,
posts, and user data live directly on the host filesystem
as regular files — you can browse, copy, and back them up
with standard tools.

### Recommended: separate disk for data

On a VPS it is best to mount a separate block volume
(e.g. Hetzner Volume, DigitalOcean Block Storage) for
your data. This gives you:

- **Independent backups** — snapshot the data disk without
  touching the OS
- **Easy migration** — detach the volume, attach to a new
  server, done
- **No risk of filling the OS disk** — photos won't break
  your system if the disk fills up
- **Scalable storage** — resize the volume without
  reinstalling the OS

Setup:

```bash
# 1. Attach and mount the volume (example for ext4)
mkfs.ext4 /dev/sdb
mkdir -p /mnt/data
mount /dev/sdb /mnt/data

# 2. Add to /etc/fstab for auto-mount on reboot
echo '/dev/sdb /mnt/data ext4 defaults 0 2' >> /etc/fstab

# 3. Point Milagram data to the volume
```

Then edit `docker-compose.yml`:

```yaml
volumes:
  - /mnt/data/milagram:/data/posts
```

Or change `DATA_DIR` in `.env` (not recommended — keep
the path in docker-compose.yml for clarity).

### Permissions

The container runs as user `milagram`. On first start
the data directory is created automatically. If you point
to an existing folder, make sure it is writable:

```bash
# Find the container user's UID
docker exec milagram-milagram-1 id
# Grant permissions
sudo chown -R <uid>:<uid> /mnt/data/milagram
```

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
- **Manually**: copy the `data/` folder — it contains
  everything (posts, photos, users, settings)
- **Restore**: copy the folder back, restart the
  container

The API key is created in the admin panel. API backup
is convenient to schedule via cron:

```bash
# Daily backup at 3:00 AM
0 3 * * * curl -sX POST http://localhost:8000/api/ext/backup \
  -H "X-API-Key: sk-..." >> /var/log/milagram-backup.log
```

If using a separate data disk (see section 6), you can
also create disk snapshots via your cloud provider's
API — this is the fastest and most reliable backup method.

---

## 8. Updating

```bash
cd /opt/milagram
git pull
docker compose up -d --build
```

Data on disk is not affected. JWT tokens remain valid
as long as `JWT_SECRET_KEY` has not changed.

---

## 9. Useful Commands

```bash
# Logs
docker compose logs -f

# Status
docker compose ps

# Stop
docker compose down

# Enter the container
docker exec -it milagram-milagram-1 bash

# Data size
du -sh ./data

# Health check
curl http://localhost:8000/api/server/ping
```

---

## Pre-Launch Checklist

- [ ] `ADMIN_PASSWORD` — a strong password is set
- [ ] `JWT_SECRET_KEY` — generated and saved
- [ ] `.env` added to `.gitignore` (do not commit passwords)
- [ ] HTTPS configured (if accessible from the internet)
- [ ] `CORS_ORIGINS` — your domain is specified (not `*`)
- [ ] Backups configured (cron, snapshots, or manual)
- [ ] Port 8000 is not exposed to the internet directly
  (only through reverse proxy)
- [ ] Data stored on a separate disk (recommended for VPS)

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

### Frontend shows 404

If `FRONTEND_PATH` or `DATA_DIR` are set in your `.env`,
they override the Dockerfile defaults. For Docker
deployment, either remove these lines from `.env`
or set them to:
```env
DATA_DIR=/data/posts
FRONTEND_PATH=/app/frontend
```
