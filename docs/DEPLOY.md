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

## 1. Prepare Data Disk

See [section 6](#6-data-storage) for detailed
instructions with examples. Short version:

```bash
mkfs.ext4 /dev/sdb          # format (only if new!)
mkdir -p /mnt/data
mount /dev/sdb /mnt/data
echo '/dev/sdb /mnt/data ext4 defaults 0 2' >> /etc/fstab
```

Skip this step if you have a single disk — see
[No separate disk?](#no-separate-disk)

## 2. Clone

```bash
git clone https://github.com/milagram/app /opt/milagram
cd /opt/milagram
```

## 3. Prepare `.env`

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

## 4. Start

```bash
docker compose up -d --build
```

What happens:

- The Docker image is built (Node.js builds the frontend,
  Python runs the backend)
- Data is stored on the data disk at `/mnt/data/milagram`
  (survives restarts and container rebuilds)
- The container listens on port `8000`
- Built-in healthcheck monitors `/api/server/ping`
- Memory limit: 512 MB
- Log rotation enabled (10 MB × 3 files)
- Automatic restart on crash (`unless-stopped`)

---

## 5. First Login

Open `http://your-server:8000`. Log in with username
`owner` (or the value from `ADMIN_USERNAME`), password
from `ADMIN_PASSWORD`.

After logging in:

- Create channels (family, travel, health...)
- Invite family members via invite links
  (channel menu → Members → Create link)
- Start uploading photos

---

## 6. HTTPS (required for internet access)

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

## 7. Data Storage Details

Milagram stores all data (photos, posts, users) on a
**separate disk** mounted at `/mnt/data`. This is the
default in docker-compose.yml:

```yaml
volumes:
  - /mnt/data/milagram:/data/posts
```

Why a separate disk:

- **Independent backups** — snapshot the data disk without
  touching the OS
- **Easy migration** — detach the volume, attach to a new
  server, done
- **No risk of filling the OS disk** — photos won't break
  your system if the disk fills up
- **Scalable storage** — resize the volume without
  reinstalling the OS

### Preparing the data disk

**Before cloning the repo**, prepare the data disk.

**Step 1.** Find your data disk:

```bash
lsblk
```

Example output:

```
NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS
sda       8:0    0   15G  0 disk
├─sda1    8:1    0 14.9G  0 part /          ← system disk (has /)
├─sda14   8:14   0    3M  0 part
└─sda15   8:15   0  124M  0 part /boot/efi
sdb       8:16   0  100G  0 disk            ← data disk (no mountpoint)
```

How to tell them apart:
- **System disk** — has partitions mounted at `/`
  and `/boot`. Do NOT format this one.
- **Data disk** — no MOUNTPOINTS column, or mounted
  at a custom path. This is the one to use.

Typical names: `sdb`, `vdb`, `xvdb`, `nvme1n1` —
depends on your cloud provider.

**Step 2.** Format and mount:

```bash
# Format the data disk (ONLY if it's empty/new!)
mkfs.ext4 /dev/sdb

# Create mount point and mount
mkdir -p /mnt/data
mount /dev/sdb /mnt/data

# Add to /etc/fstab for auto-mount on reboot
echo '/dev/sdb /mnt/data ext4 defaults 0 2' >> /etc/fstab
```

**Step 3.** Verify:

```bash
df -h /mnt/data
```

Expected output:

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/sdb         98G   24K   93G   1% /mnt/data
```

Check two things:
- **Mounted on** = `/mnt/data` (not `/`)
- **Size** matches your data disk (here 98G from a 100G
  disk — ext4 reserves ~5% for system needs)

Now proceed to section 1 (Clone) and run
`docker compose up`. The data folder at
`/mnt/data/milagram` will be created automatically.

### No separate disk?

If your server has a single disk (local development,
home server), edit `docker-compose.yml`:

```yaml
volumes:
  - ./data:/data/posts
```

This stores data next to docker-compose.yml.

### Permissions

The container runs as user `milagram`. On first start
the data directory is created automatically. If you see
permission errors:

```bash
# Find the container user's UID
docker exec milagram-milagram-1 id
# Grant permissions
sudo chown -R <uid>:<uid> /mnt/data/milagram
```

---

## 8. Backups

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

If using a separate data disk (see section 7), you can
also create disk snapshots via your cloud provider's
API — this is the fastest and most reliable backup method.

---

## 9. Updating

```bash
cd /opt/milagram
git pull
docker compose up -d --build
```

Data on disk is not affected. JWT tokens remain valid
as long as `JWT_SECRET_KEY` has not changed.

---

## 10. Useful Commands

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
