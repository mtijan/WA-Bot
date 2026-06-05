# WA-Bot VPS Deploy Templates

**Status:** Template, belum dijalankan di VPS produksi  
**Target OS:** Ubuntu LTS  
**Recommended domain layout:** `https://<domain>` serves frontend static files and proxies `/api` to backend `127.0.0.1:3001`.

Use this directory as a starting point, not as copy-paste without review. Replace every placeholder before deployment.

## Files

| File | Purpose |
|------|---------|
| `wa-bot.env.example` | Backend environment file template for `/etc/wa-bot/wa-bot.env`. |
| `pm2.ecosystem.config.cjs` | PM2 multi-process template for API and combined worker. |
| `systemd/wa-bot-api.service` | systemd service template for API-only process. |
| `systemd/wa-bot-worker.service` | systemd service template for combined worker/session process. |
| `nginx/wa-bot.conf` | Nginx static frontend + `/api` reverse proxy template. |
| `caddy/Caddyfile` | Caddy alternative with automatic HTTPS. |
| `logrotate/wa-bot` | Log rotation template for app logs. |
| `ufw.commands.txt` | Firewall command checklist. |
| `security_acl.commands.txt` | Filesystem permission checklist for sessions, database, env, and logs. |
| `BACKUP_SCHEDULE.commands.md` | systemd timer command sheet for encrypted backups and restore drills. |
| `MONITORING_SETUP.commands.md` | monitoring command sheet for endpoint, process, resource, and backup freshness checks. |

## Recommended VPS Layout

```text
/opt/wa-bot/
  backend/
  frontend/dist/
  logs/

/etc/wa-bot/
  wa-bot.env
```

Do not place `backend/database.sqlite`, `backend/sessions/`, backups, or `.env` files inside a public static webroot.

## Deployment Order

1. Create a non-root user:

```bash
sudo adduser --disabled-password --gecos "" wa-bot
sudo mkdir -p /opt/wa-bot /etc/wa-bot /var/log/wa-bot
sudo chown -R wa-bot:wa-bot /opt/wa-bot /var/log/wa-bot
sudo chmod 750 /etc/wa-bot
```

2. Upload or clone the project into `/opt/wa-bot`.
3. Build frontend locally or on VPS:

```bash
cd /opt/wa-bot/frontend
npm ci
npm run build
```

4. Install backend dependencies and run migrations:

```bash
cd /opt/wa-bot/backend
npm ci --omit=dev
npm run db:migrate
```

5. Create `/etc/wa-bot/wa-bot.env` from `wa-bot.env.example`, then lock it down:

```bash
sudo chown root:wa-bot /etc/wa-bot/wa-bot.env
sudo chmod 640 /etc/wa-bot/wa-bot.env
```

6. Choose one process manager:
   - systemd: copy `systemd/*.service` into `/etc/systemd/system/`.
   - PM2: copy `pm2.ecosystem.config.cjs` into `/opt/wa-bot/`.

7. Choose one reverse proxy:
   - Nginx: copy `nginx/wa-bot.conf` and configure Certbot.
   - Caddy: copy `caddy/Caddyfile` and let Caddy manage TLS.

8. Enable firewall using `ufw.commands.txt`.
9. Review and apply runtime-data permissions using `security_acl.commands.txt`.
10. Schedule encrypted backups using `BACKUP_SCHEDULE.commands.md`.
11. Configure monitoring using `MONITORING_SETUP.commands.md` and `docs/MONITORING.md`.
12. Run smoke checks:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/health/ready
curl -fsS http://127.0.0.1:3002/internal/health/ready -H "X-Internal-Token: <token>"
curl -fsS https://<domain>/
curl -fsS https://<domain>/api/auth/me
```

## Production Notes

- Backend port `3001` must stay private.
- Public browser traffic should call `/api`, not `:3001`.
- Set `WA_BOT_COOKIE_SECURE=true` only after HTTPS is active.
- Use long random secrets for admin session, API key, internal token, secret encryption, and backup encryption.
- Move encrypted backups off the VPS or to a protected volume.
- Fill `docs/MONITORING.md` evidence table before marking monitoring complete.

## Current Staging Shortcut

For environment-specific staging notes, keep a local-only `docs/STAGING.md` and do not commit real IP addresses, SSH users, secrets, or provider details. The current verified baseline is HTTP/IP only; do not enable `WA_BOT_COOKIE_SECURE=true` until HTTPS is working.

Recommended staging order from here:

1. Configure domain/TLS with the generic Caddy template.
2. `BACKUP_SCHEDULE.commands.md`
3. `MONITORING_SETUP.commands.md`
4. Browser smoke test and evidence update
