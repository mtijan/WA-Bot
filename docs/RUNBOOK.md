# WA-Bot Pro Operations Runbook

**Status:** Internal baseline  
**Last updated:** 2026-06-06

## 1. Local Start

### Windows

Run:

```powershell
.\run.bat
```

The Windows launcher opens the backend in a separate window and prompts for admin credentials. Enter a password to enable the HttpOnly-cookie admin login for that local session, or leave the password blank to run in local mode without dashboard login.

### Linux, macOS, WSL, or Git Bash

Run:

```bash
./run.sh
```

Expected local endpoints:

| Service | URL |
|---------|-----|
| Backend API | `http://localhost:3001/api` |
| Frontend Vite development server | `http://localhost:5173` or `http://localhost:5174` |

## 2. Runtime Dependencies

- Node.js `18.16.0` or newer
- npm `9.x` or newer
- Writable backend directory for SQLite and Baileys auth files
- Google Chrome at the configured path when running Puppeteer QA on Windows

Install dependencies separately:

```powershell
Set-Location .\backend
npm install
Set-Location ..\frontend
npm install
Set-Location ..\qa_tests
npm install
```

## 3. Backend Security Configuration

Copy `backend/.env.example` into your deployment secret-management workflow. The application reads values from the process environment; do not commit a real `.env` file.

| Variable | Purpose |
|----------|---------|
| `WA_BOT_ADMIN_USERNAME` | Admin username for dashboard login. Defaults to `admin`. |
| `WA_BOT_ADMIN_PASSWORD` | Enables admin dashboard login and protects `/api/*` browser access. Required before public exposure. |
| `WA_BOT_ADMIN_SESSION_SECRET` | Signs the HttpOnly admin session cookie. Use a long random secret. |
| `WA_BOT_ADMIN_SESSION_TTL_MS` | Admin session lifetime in milliseconds. Defaults to 12 hours. |
| `WA_BOT_COOKIE_SECURE` | Set to `true` only when the dashboard is served over HTTPS. |
| `WA_BOT_API_KEY` | Enables `X-API-Key` access for trusted server-to-server callers. Do not put this in frontend JavaScript. |
| `WA_BOT_ALLOWED_ORIGINS` | Comma-separated browser origins accepted by CORS. |
| `WA_BOT_RATE_LIMIT_WINDOW_MS` | Rate-limit window in milliseconds. |
| `WA_BOT_RATE_LIMIT_MAX` | Maximum API requests per client IP per window. |
| `WA_BOT_SECRET_ENCRYPTION_KEY` | Encrypts newly saved Chatbot AI provider keys using AES-256-GCM. |
| `WA_BOT_LOG_RETENTION_DAYS` | Delivery-log retention used by the cleanup script. |
| `WA_BOT_BACKUP_DIR` | Optional protected destination for timestamped runtime-data backups. |
| `WA_BOT_TRUST_PROXY_HOPS` | Optional trusted proxy hop count. Set only behind a known proxy. |
| `WA_BOT_PROCESS_ROLE` | Runtime role. Supported values: `all`, `api`, `sessions`, `campaign-worker`, `warmer-worker`, `worker`. Defaults to `all`. |
| `WA_BOT_PROCESS_HEARTBEAT_MS` | Worker heartbeat log interval. Defaults to `60000`; set `0` to disable. |
| `WA_BOT_CAMPAIGN_WORKER_POLL_MS` | Campaign worker polling interval for pending campaigns. Defaults to `15000`. |
| `WA_BOT_WARMER_WORKER_POLL_MS` | Warmer worker polling interval for running warmer campaigns. Defaults to `30000`. |
| `WA_BOT_INTERNAL_TOKEN` | Shared secret for the internal process control API. Required for `/internal/sessions/*`. |
| `WA_BOT_INTERNAL_PORT` | Optional internal listener port. Defaults by role: `sessions/worker=3002`, `campaign-worker=3003`, `warmer-worker=3004`. |
| `WA_BOT_SESSION_MANAGER_URL` | Internal session-manager base URL used by API-only mode, for example `http://127.0.0.1:3002/internal`. |
| `WA_BOT_MEDIA_UPLOAD_DIR` | Optional media upload directory. Defaults to `backend/uploads/media`. Keep it outside the frontend webroot. |
| `WA_BOT_IMAGE_UPLOAD_MAX_BYTES` | Optional image upload limit. Defaults to `5242880` bytes / 5 MB. |
| `WA_BOT_VIDEO_UPLOAD_MAX_BYTES` | Optional video upload limit. Defaults to `10485760` bytes / 10 MB. |
| `WA_BOT_ALERT_TELEGRAM_BOT_TOKEN` | Optional Telegram bot token used by `npm run monitor:alert`. Keep it secret and out of git. |
| `WA_BOT_ALERT_TELEGRAM_CHAT_ID` | Optional Telegram destination chat ID used by `npm run monitor:alert`. Keep it out of git. |
| `WA_BOT_ALERT_WEBHOOK_URL` | Optional external alert webhook used by `npm run monitor:alert`. Keep it secret and out of git. |
| `WA_BOT_ALERT_PUBLIC_URL` | Optional public frontend URL checked by `npm run monitor:alert`. |
| `WA_BOT_ALERT_PUBLIC_HEALTH_URL` | Optional public health URL checked by `npm run monitor:alert`. |
| `WA_BOT_ALERT_BACKUP_MAX_AGE_HOURS` | Optional encrypted-backup freshness threshold. Defaults to `36`. |
| `WA_BOT_ALERT_DISK_WARN_PERCENT` | Optional disk usage warning threshold. Defaults to `80`. |

Do not ship the backend API key inside frontend JavaScript. Public browser deployments should use an authenticated reverse proxy or server-side session layer.

After configuring `WA_BOT_SECRET_ENCRYPTION_KEY`, open and save each existing Chatbot AI configuration once to migrate older plaintext provider keys into ciphertext.

## 4. Backend Runtime Roles

The default local mode remains monolith:

```powershell
Set-Location .\backend
npm start
```

For deployment hardening, the backend can now run by role:

| Role | Command | Responsibility |
|------|---------|----------------|
| Monolith | `npm start` | Starts API, restores WhatsApp sessions, and runs campaign/warmer workers inline. Best for local development. |
| API only | `npm run start:api` | Starts Express API and dashboard endpoints without inline background workers. |
| Session manager | `npm run start:sessions` | Restores WhatsApp sessions and keeps Baileys sockets alive without opening HTTP API. |
| Campaign worker | `npm run start:campaign-worker` | Restores sessions and polls SQLite for `PENDING` bulk campaigns. |
| Warmer worker | `npm run start:warmer-worker` | Restores sessions and polls SQLite for `RUNNING` warmer campaigns. |
| Combined worker | `npm run start:worker` | Restores sessions and runs both campaign and warmer workers without HTTP API. |

Recommended production baseline before full IPC is implemented:

```powershell
Set-Location .\backend
npm run start:api
```

In a second managed process:

```powershell
Set-Location .\backend
npm run start:worker
```

For a stronger API + session-manager split, configure the same internal token in both processes.

Terminal/process 1:

```powershell
Set-Location .\backend
$env:WA_BOT_INTERNAL_TOKEN="replace-with-a-long-random-token"
npm run start:sessions
```

Terminal/process 2:

```powershell
Set-Location .\backend
$env:WA_BOT_INTERNAL_TOKEN="replace-with-a-long-random-token"
$env:WA_BOT_SESSION_MANAGER_URL="http://127.0.0.1:3002/internal"
npm run start:api
```

Readiness endpoints:

| Process | Endpoint |
|---------|----------|
| API | `GET http://127.0.0.1:3001/health/ready` |
| Session manager / combined worker | `GET http://127.0.0.1:3002/internal/health/ready` |
| Campaign worker granular | `GET http://127.0.0.1:3003/internal/health/ready` |
| Warmer worker granular | `GET http://127.0.0.1:3004/internal/health/ready` |

Current limitation: the internal session-manager API currently covers session list/status/init/delete/proxy update. Other socket-heavy features such as group grabber, single-message sending, campaign sending, and warmer sending still execute in the process that owns Baileys sockets and need further internal delegation before a fully granular production split.

## 5. Database Migration

Schema changes are managed through versioned migrations. Do not add new `CREATE TABLE` or `ALTER TABLE` statements directly inside `src/database.js`.

Run migrations from `backend/`:

```powershell
npm run db:migrate
```

This command creates a runtime backup first, then applies unapplied migrations and records them in `schema_migrations`.

For disposable local databases only:

```powershell
npm run db:migrate:no-backup
```

Current migration module:

```text
backend/src/migrations/index.js
```

Migration evidence to record for release candidates:

| Field | Value |
|-------|-------|
| Migration command | `npm run db:migrate` |
| Backup directory | |
| Applied migration IDs | |
| Operator | |
| Result | |

## 6. Release Candidate Verification

Start backend and frontend first, then execute:

```powershell
Set-Location .\qa_tests
npm test
```

Record the result:

| Field | Value |
|-------|-------|
| Release version | |
| Execution date and timezone | |
| Operator | |
| Operating system | |
| Node.js version | |
| Backend URL | |
| Frontend URL | |
| QA command | `npm test` |
| Result | |
| Screenshot directory | `qa_tests/screenshots/` |
| Known gaps accepted | |

The QA script checks all 16 application tables. Keep the table list aligned with future schema migrations.

## 7. SQLite Backup

Stop write-heavy operations before backup. Copy these artifacts to protected storage:

```text
backend/database.sqlite
backend/sessions/
backend/uploads/
```

Session auth files contain sensitive linked-device credentials. Protect backups with encryption and restricted access.
Uploaded media may contain business or personal data. Include `backend/uploads/` in backups only when preserving template/chatbot assets is required, and define retention before production use.

Create a timestamped local backup from `backend/`:

```powershell
npm run backup
```

Use `WA_BOT_BACKUP_DIR` to direct the output to encrypted protected storage.

Create an encrypted runtime backup from `backend/`:

```powershell
$env:WA_BOT_BACKUP_ENCRYPTION_KEY="replace-with-a-long-random-backup-secret"
npm run backup:encrypted
```

The encrypted backup stores each runtime file with AES-256-GCM and writes a manifest. Keep `WA_BOT_BACKUP_ENCRYPTION_KEY` outside the backup destination. Use `WA_BOT_ENCRYPTED_BACKUP_DIR` to send encrypted backups to protected storage.

## 8. SQLite Restore Drill

1. Stop the backend.
2. Preserve the current database as a rollback copy.
3. Restore `backend/database.sqlite` from the selected backup.
4. Restore only the intended session directories if session recovery is required.
5. Start the backend and verify sessions, campaign history, contacts, and Chatbot AI settings.
6. Run the QA suite and record the outcome.

Run a non-destructive encrypted restore drill from `backend/`:

```powershell
$env:WA_BOT_BACKUP_ENCRYPTION_KEY="replace-with-a-long-random-backup-secret"
npm run restore:drill
```

This restores the latest encrypted backup into `backend/restore_drills/` by default, validates the SQLite database can be opened, and does not overwrite live runtime data.

Encrypted restore drill evidence:

| Field | Value |
|-------|-------|
| Backup source | |
| Restore drill directory | |
| SQLite table count | |
| Operator | |
| Result | |

## 9. Deployment Notes

Use `docs/deploy/README.md` as the deploy-template source of truth. It includes PM2, systemd, Nginx, Caddy, firewall, logrotate, env, and smoke-check templates.

Before public deployment:

- place the backend behind TLS termination and authentication;
- restrict CORS origins;
- configure rate limiting;
- apply filesystem ACLs and encryption at-rest;
- keep SQLite and session files outside any static webroot;
- keep uploaded media under the authenticated `/api/uploads` path and out of git;
- use a process manager such as PM2 only after log rotation is configured;
- run API and worker roles as separate PM2/systemd processes when validating deploy architecture;
- verify consent, opt-out, and data-retention rules.

Frontend production builds default to `/api`, so the recommended public layout is `https://<domain>` serving `frontend/dist` and proxying `/api` to `http://127.0.0.1:3001/api`. Do not expose backend port `3001` directly.

`frontend/package.json` runs `scripts/assert-production-api-url.mjs` after every production build. This guard fails the build when generated assets contain direct private backend URLs such as `:3001/api`. If staging login fails with `Failed to fetch` and DevTools shows requests to `:3001/api/auth/login`, set `VITE_API_URL=/api` in the frontend env, rebuild, reload the reverse proxy, and hard-refresh the browser cache.

See `docs/SECURITY.md` for the production checklist.

Security checks before VPS exposure:

```bash
cd /opt/wa-bot/backend
npm run security:audit
```

Alert check before VPS exposure:

```bash
cd /opt/wa-bot/backend
npm run monitor:alert
```

Review `docs/deploy/security_acl.commands.txt` before migrating to a dedicated `wa-bot` service user. Current staging ACL baseline is applied for the active `ubuntu` service user.

### 9.1 Staging VPS Evidence - 2026-06-05

Staging baseline has been verified on an Ubuntu 24.04.4 VPS. Keep the exact IP/provider details in local-only `docs/STAGING.md`.

Verified inventory:

* App path: `/opt/wa-bot`
* Env file: `/etc/wa-bot/wa-bot.env`
* Node.js: `v22.22.3`
* npm: `10.9.8`
* Caddy: `v2.11.4`
* systemd services: `wa-bot-api` and `wa-bot-worker`
* Public access shape: domain HTTPS through Caddy; backend port remains private

Verified checks:

```bash
curl http://127.0.0.1/health
curl http://127.0.0.1/api/auth/me
curl http://127.0.0.1:3001/health/ready
TOKEN=$(sudo grep '^WA_BOT_INTERNAL_TOKEN=' /etc/wa-bot/wa-bot.env | cut -d= -f2-)
curl http://127.0.0.1:3002/internal/health/ready -H "X-Internal-Token: $TOKEN"
```

Observed result: API and worker both returned `status=ready`, database check `ok`, and worker polling flags were active for campaign/warmer worker in the combined worker role.

Additional hardening evidence recorded on 2026-06-05:

* UFW active with default deny incoming and inbound `22/tcp`, `80/tcp`, `443/tcp` only.
* Public staging `/health` returned `status=healthy` after UFW was enabled.
* `WA_BOT_BACKUP_ENCRYPTION_KEY`, `WA_BOT_ENCRYPTED_BACKUP_DIR`, and `WA_BOT_RESTORE_DRILL_DIR` are set in `/etc/wa-bot/wa-bot.env` without exposing secret values.
* Encrypted backup created at `/opt/wa-bot/encrypted_backups/2026-06-05T03-14-35-612Z`.
* Restore drill succeeded with SQLite table count `18` and did not overwrite live runtime data.
* `wa-bot-backup.timer` and `wa-bot-restore-drill.timer` are enabled.
* `wa-bot-healthcheck.timer` is enabled and checks API, worker, Caddy, disk usage, and backup freshness every minute.
* HTTP smoke check passed for frontend `/` and `/api/auth/me` through local Caddy.
* `/etc/logrotate.d/wa-bot` is installed for `/var/log/wa-bot/*.log`.
* Domain HTTPS smoke passed for `/health`, `/api/auth/me`, and frontend `/`.
* HTTP requests redirect to HTTPS with `308 Permanent Redirect`.
* Provider firewall review passed: inbound public access is limited to SSH `22`, HTTP `80`, and HTTPS `443`; direct public access to backend port `3001` timed out.
* `WA_BOT_COOKIE_SECURE=true` and domain-specific `WA_BOT_ALLOWED_ORIGINS` are applied on staging.
* Required secret env values were reviewed for placeholders and rotated where needed. Do not print secret values in logs or docs.
* Admin HTTPS auth smoke passed: login, Secure cookie, authenticated `/api/auth/me`, and logout.
* Manual browser smoke over HTTPS passed: login, dashboard, session manager, contact groups, templates, proxy manager, and logout were checked by the operator.
* A staging regression where the frontend bundle called `:3001/api/auth/login` directly was fixed by rebuilding with `VITE_API_URL=/api`; future builds are protected by the frontend production API URL guard.

Do not treat this as production-ready. Staging lightweight Telegram alerting is verified, but remaining hardening still includes encrypted offsite backup copy when storage is available and the broader production hardening decisions recorded in the roadmap. Media upload is complete, but uploaded media should still be treated as protected runtime data.

For the full staging note, see `docs/STAGING.md`.
For the next manual hardening commands, see `docs/deploy/STAGING_HARDENING.commands.md`.
For scheduled encrypted backups, see `docs/deploy/BACKUP_SCHEDULE.commands.md`.
For monitoring setup commands, see `docs/deploy/MONITORING_SETUP.commands.md`.

## 10. Monitoring and Alerts

Use `docs/MONITORING.md` as the monitoring source of truth before VPS exposure.

Minimum monitoring checklist:

- API liveness: `GET /health`;
- API readiness: `GET /health/ready`;
- internal worker readiness: `GET /internal/health/ready`;
- disk usage warning and critical thresholds;
- process death alert for API and worker roles;
- disconnected WhatsApp session review;
- stuck `RUNNING` campaign review;
- encrypted backup freshness alert.

Recommended local/VPS tools:

| Tool | Purpose |
|------|---------|
| Uptime Kuma | HTTP health/readiness monitors and notifications |
| Netdata | CPU, RAM, disk, and process/resource visibility |
| PM2/systemd | Process restart policy and service state |

Do not mark item 5 as production-complete until the evidence table in `docs/MONITORING.md` is filled for the actual VPS.

## 11. Maintenance Cadence

| Frequency | Task |
|-----------|------|
| Daily | Review backend errors and disconnected sessions. |
| Weekly | Review failed campaigns, stale sessions, and storage growth. |
| Monthly | Archive or delete old delivery logs according to retention policy and run a restore drill. |
| Before each release | Run QA, scan for secrets, verify backup, and review dependency changes. |

Preview monthly delivery-log cleanup from `backend/`:

```powershell
npm run logs:prune
```

After reviewing the count and confirming a backup:

```powershell
npm run logs:prune:apply
```

See `docs/PRIVACY.md` for consent, opt-out, and retention requirements.
