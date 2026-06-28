# WA-Bot Monitoring & Alert Template

**Status:** Staging Telegram alert timer installed; healthy timer, forced alert evidence, and browser feature smoke evidence recorded  
**Last updated:** 2026-06-16

Dokumen ini menjadi acuan monitoring sebelum deploy publik. Targetnya adalah memastikan proses mati, endpoint tidak ready, disk penuh, sesi WhatsApp putus, campaign macet, dan backup gagal bisa diketahui sebelum berdampak ke pengguna.

For VPS command steps, use `docs/deploy/MONITORING_SETUP.commands.md` and the lightweight webhook baseline in `docs/deploy/EXTERNAL_ALERTING.commands.md`.

## 1. Monitoring Targets

| Target | URL / Command | Expected | Alert If |
|--------|---------------|----------|----------|
| API liveness | `GET http://127.0.0.1:3001/health` | HTTP `200` | HTTP bukan `200` selama 2-3 menit |
| API readiness | `GET http://127.0.0.1:3001/health/ready` | JSON `status=ready` | HTTP `503` atau `status!=ready` |
| Session manager readiness | `GET http://127.0.0.1:3002/internal/health/ready` | JSON `status=ready` | HTTP `503` atau proses tidak merespons |
| Combined worker readiness | `GET http://127.0.0.1:3002/internal/health/ready` | JSON `status=ready` | Worker tidak merespons |
| Campaign worker readiness | `GET http://127.0.0.1:3003/internal/health/ready` | JSON `status=ready` | Worker granular tidak merespons |
| Warmer worker readiness | `GET http://127.0.0.1:3004/internal/health/ready` | JSON `status=ready` | Worker granular tidak merespons |
| Chatbot failed replies | `GET http://127.0.0.1:3002/internal/health/failed-replies` | JSON `status=success` | JSON `status=warning` (ada pesan gagal terbalas) atau proses tidak merespons |
| Public frontend | `https://<domain>/` or staging HTTP/IP local evidence | HTTP `200` | HTTP bukan `200` |
| Public API via reverse proxy | `https://<domain>/api/auth/me` or staging HTTP/IP local evidence | HTTP `200` | HTTP bukan `200` / reverse proxy rusak |
| Disk usage | OS monitor | `<80%` | `>=80% warning`, `>=90% critical` |
| RAM usage | OS monitor | stable | sustained `>=85%` |
| CPU load | OS monitor | stable | sustained high load for 10 minutes |
| Backup freshness | backup directory timestamp | recent backup exists | no backup in expected window |

## 2. Uptime Kuma Setup

Recommended monitors:

| Name | Type | URL | Interval | Retry | Notes |
|------|------|-----|----------|-------|-------|
| `wa-bot-api-live` | HTTP(s) | `http://127.0.0.1:3001/health` | 60s | 3 | Local/VPS internal monitor |
| `wa-bot-api-ready` | HTTP(s) | `http://127.0.0.1:3001/health/ready` | 60s | 3 | Must return 200 |
| `wa-bot-session-ready` | HTTP(s) | `http://127.0.0.1:3002/internal/health/ready` | 60s | 3 | Use when session manager/combined worker is active |
| `wa-bot-public-frontend` | HTTP(s) | `https://<domain>/` | 60s | 3 | Use staging IP only before domain exists |
| `wa-bot-public-auth` | HTTP(s) | `https://<domain>/api/auth/me` | 60s | 3 | Confirms reverse proxy path |

Notification channels:

* Telegram bot or email for low-cost alerting.
* Use a separate operator account from the application admin account.
* Escalate if API and worker are both down for more than 5 minutes.

## 2.1 Lightweight Webhook Alert Baseline

The repository includes a lightweight alert script for staging when a full monitoring stack is not installed yet:

```bash
cd /opt/wa-bot/backend
npm run monitor:alert
```

It checks API readiness, worker readiness, unresolved failed replies, optional public HTTPS URLs, disk usage, and encrypted-backup freshness. If a check fails, it sends an alert to Telegram and/or `WA_BOT_ALERT_WEBHOOK_URL`.

Required env values:

| Variable | Purpose |
|----------|---------|
| `WA_BOT_ALERT_TELEGRAM_BOT_TOKEN` | Telegram bot token. Keep secret and never commit. |
| `WA_BOT_ALERT_TELEGRAM_CHAT_ID` | Telegram destination chat ID. Keep private and out of git. |
| `WA_BOT_ALERT_WEBHOOK_URL` | Optional external webhook destination. Keep secret and never commit. |
| `WA_BOT_ALERT_PUBLIC_URL` | Optional public frontend URL, e.g. `https://stagingwabot.web.id/`. |
| `WA_BOT_ALERT_PUBLIC_HEALTH_URL` | Optional public health URL, e.g. `https://stagingwabot.web.id/health`. |
| `WA_BOT_ALERT_FAILED_REPLIES_URL` | Optional unresolved failed replies endpoint URL, e.g. `http://127.0.0.1:3002/internal/health/failed-replies`. |
| `WA_BOT_ALERT_BACKUP_MAX_AGE_HOURS` | Backup freshness threshold. Default `36`. |
| `WA_BOT_ALERT_DISK_WARN_PERCENT` | Disk warning threshold. Default `80`. |

Install it as a systemd timer using `docs/deploy/EXTERNAL_ALERTING.commands.md`.

## 3. Netdata / Resource Alerts

Netdata is installed natively on the host (without Docker) to monitor system resources (CPU, RAM, Disk, and Network IO). For security, the Netdata dashboard is bound to localhost (`127.0.0.1:19999`) and is accessed securely from a local machine via SSH Tunneling:

```bash
# From local machine terminal:
ssh -L 18181:127.0.0.1:19999 ubuntu@43.157.224.57
```

Then accessed locally at `http://localhost:18181/`.

### Recommended Resource Thresholds:

| Resource | Warning | Critical | Action |
|----------|---------|----------|--------|
| Disk used | `>=80%` | `>=90%` | Prune logs (`npm run logs:prune:apply`), move backups off VPS, expand disk |
| RAM used | `>=85%` sustained | `>=95%` sustained | Restart leaking process, reduce sessions, inspect Baileys |
| CPU load | sustained high load 10m | sustained high load 20m | Inspect worker loop and campaign throughput |
| SQLite size | unusual growth | disk risk | Run retention jobs (`npm run logs:prune:apply`) and vacuum database |


## 4. Process Monitoring

Track every runtime role explicitly.

| Process | Command | Must Restart | Notes |
|---------|---------|--------------|-------|
| API | `npm run start:api` | yes | Exposes HTTP API only |
| Session manager / worker | `npm run start:worker` or `npm run start:sessions` | yes | Owns Baileys sockets |
| Campaign worker | `npm run start:campaign-worker` | yes | Optional granular split |
| Warmer worker | `npm run start:warmer-worker` | yes | Optional granular split |

Preferred production baseline before full granular split:

```powershell
npm run start:api
npm run start:worker
```

## 4.1 User Quota & Resource Usage Monitoring (Admin-Only)

Administrator dapat memantau penggunaan sumber daya dan kuota masing-masing pengguna langsung melalui dashboard System Monitoring di rute `/monitoring`.

Metrik berikut dipantau secara real-time:
* **Devices / Sesi WhatsApp**: Jumlah sesi terdaftar per user (termasuk status aktif/koneksi saat ini) dibandingkan dengan limit paket (`max_sessions`).
* **Bulk Messages (Bulan Ini)**: Jumlah pesan broadcast yang dikirim oleh user pada bulan berjalan dibandingkan dengan limit bulanan (`max_campaigns_per_month`).
* **Chatbot Flows**: Jumlah alur chatbot yang dibuat oleh user dibandingkan dengan limit paket (`max_flows`).

### Mekanisme API

Saat admin mengakses endpoint `/api/monitoring/status`, backend menjalankan kueri optimal berikut:
```sql
SELECT 
  u.id, 
  u.username, 
  u.display_name,
  p.name as plan_name,
  COALESCE(p.max_sessions, 0) as max_sessions,
  COALESCE(p.max_campaigns_per_month, 0) as max_campaigns_per_month,
  COALESCE(p.max_flows, 0) as max_flows,
  (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) as current_sessions,
  (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND status = 'CONNECTED') as active_sessions,
  (SELECT COUNT(*) FROM campaigns WHERE user_id = u.id AND created_at >= ?) as current_campaigns,
  (SELECT COUNT(*) FROM chatbot_flows WHERE user_id = u.id) as current_flows
FROM users u
LEFT JOIN subscription_plans p ON u.plan_id = p.id
ORDER BY u.username ASC
```
Data ini di-render dalam tabel glassmorphic responsif dengan penyorotan warna merah jika limit terlampaui.

## 5. Application Health Queries

Use these SQLite checks for manual investigation or future alert scripts.

Disconnected sessions:

```sql
SELECT session_id, phone_number, status
FROM sessions
WHERE status != 'CONNECTED';
```

Stuck campaigns:

```sql
SELECT id, name, session_id, status, created_at
FROM campaigns
WHERE status = 'RUNNING'
  AND datetime(created_at) < datetime('now', '-30 minutes');
```

Long-running warmer campaigns:

```sql
SELECT id, name, status, started_at, duration
FROM warmer_campaigns
WHERE status = 'RUNNING'
  AND datetime(started_at, '+' || duration || ' minutes') < datetime('now');
```

Recent backup check should verify:

* latest encrypted backup directory exists;
* `manifest.json` exists;
* encrypted file count is greater than zero;
* restore drill has been performed on a schedule.

## 6. Alert Response Runbook

| Alert | First Check | Recovery |
|-------|-------------|----------|
| API down | process status, logs, `/health/ready` | restart API process, inspect env/config |
| Worker down | internal readiness endpoint, worker logs | restart worker, check sessions directory permissions |
| Session disconnected | dashboard sessions, Baileys logs | wait for reconnect, re-scan QR only if logged out |
| Campaign stuck | campaign progress, session status | pause/requeue after verifying session is connected |
| Disk high | backup/log/database size | move encrypted backups off VPS, run log retention |
| Backup stale | backup directory timestamp | run `npm run backup:encrypted`, inspect scheduler |

## 7. Production Evidence Template

| Field | Value |
|-------|-------|
| Date / timezone | |
| VPS hostname | |
| Monitor tool | Uptime Kuma / Netdata / Other |
| Notification channel tested | |
| API live monitor | |
| API ready monitor | |
| Worker ready monitor | |
| Disk/RAM alerts | |
| Backup freshness alert | |
| Test alert sent | |
| Operator | |

Do not mark VPS monitoring as production-complete until this evidence table is filled for the actual VPS.

## 8. Staging Evidence - 2026-06-05

Manual checks on the staging VPS confirmed that the deploy baseline is alive. Keep real IP/provider details in local-only `docs/STAGING.md`, not in public repository docs.

| Check | Result |
|-------|--------|
| `GET http://127.0.0.1/health` | `status=healthy` |
| `GET http://127.0.0.1/api/auth/me` | `status=success`, auth enabled, unauthenticated user |
| `GET http://127.0.0.1:3001/health/ready` | `status=ready`, role `api`, database `ok` |
| `GET http://127.0.0.1:3002/internal/health/ready` with `X-Internal-Token` | `status=ready`, role `worker`, database `ok`, campaign/warmer polling active |
| Public HTTP after UFW | staging public `/health` returned `status=healthy`; exact IP is kept in local-only evidence |
| UFW | active; only `22/tcp`, `80/tcp`, and `443/tcp` allowed inbound |
| Backup timer | `wa-bot-backup.timer` enabled; next run `2026-06-06 02:30:00 CST` |
| Restore drill timer | `wa-bot-restore-drill.timer` enabled; next run `2026-06-07 03:00:00 CST` |
| Latest restore drill | SQLite table count `18`; live runtime data was not overwritten |
| Local healthcheck timer | `wa-bot-healthcheck.timer` enabled; checks API, worker, Caddy, disk, and backup freshness every minute |
| Latest local healthcheck | OK; disk `12%`; latest backup age `0h`; latest backup `/opt/wa-bot/encrypted_backups/2026-06-05T03-14-35-612Z/manifest.json` |
| HTTP smoke | Frontend `GET http://127.0.0.1/` OK; `GET http://127.0.0.1/api/auth/me` returned auth status JSON |
| Domain HTTPS smoke | staging domain `/health`, `/api/auth/me`, and frontend `/` returned OK over HTTPS |
| HTTP redirect | staging domain HTTP returned `308 Permanent Redirect` to HTTPS |
| Provider firewall | inbound public access limited to `22/tcp`, `80/tcp`, and `443/tcp`; direct public backend port `3001` timed out |
| Secure cookie/CORS | `WA_BOT_COOKIE_SECURE=true` and domain-specific `WA_BOT_ALLOWED_ORIGINS` applied on staging |
| Auth HTTPS smoke | Login, Secure cookie, authenticated `/api/auth/me`, and logout passed |
| Manual browser smoke HTTPS | Operator confirmed login, dashboard, session manager, contact groups, templates, proxy manager, and logout worked over HTTPS |

## 9. Telegram Alert Timer Evidence - 2026-06-06

The lightweight alert timer has been installed on staging and is running through systemd.

| Check | Result |
|-------|--------|
| Timer | `wa-bot-alertcheck.timer` enabled and active/waiting |
| Service | `wa-bot-alertcheck.service` runs `npm run monitor:alert` from `/opt/wa-bot/backend` |
| Schedule | every 1 minute using `OnUnitActiveSec=1min` |
| Notification channel | Telegram env configured in `/etc/wa-bot/wa-bot.env`; token and chat ID are not recorded in docs |
| Healthy run at `2026-06-06T06:35:03Z` | `status=ok`; API ready, worker ready, public frontend, public health, disk usage, and backup freshness all OK |
| Healthy run at `2026-06-06T06:36:30Z` | `status=ok`; API ready, worker ready, public frontend, public health, disk usage, and backup freshness all OK |
| Forced alert run at `2026-06-06T06:41:19Z` | `WA_BOT_ALERT_API_READY_URL=http://127.0.0.1:3999/health/ready npm run monitor:alert` returned `status=alert`; `api-ready` failed intentionally with `fetch failed`; worker, public frontend, public health, disk usage, and backup freshness remained OK |
| Disk usage evidence | `11.1%` |
| Backup freshness evidence | latest backup age `12.2h` |

Staging monitoring baseline is now **DONE for lightweight Telegram alerting**: healthy timer runs and an intentional API readiness failure have both been recorded. Production monitoring can still be expanded later with Uptime Kuma/Netdata for deeper CPU/RAM visibility and with offsite-backup freshness checks once offsite storage exists.

## 10. Browser Feature Smoke Evidence - 2026-06-07

Manual staging browser smoke passed after the split-process socket delegation work and Chatbot Flow large-data updates.

| Check | Result |
|-------|--------|
| Login/logout | PASS |
| Protected dashboard/API after logout | PASS |
| Dashboard without `Failed to fetch` | PASS |
| Devices / Session Manager | PASS |
| Manual session Repair button and trigger | PASS |
| Single Message text send | PASS |
| Single Message media upload and send to custom number | PASS |
| Templates media upload and use | PASS |
| Chatbot Flow list/actions/metrics/edit/settings/nodes | PASS |
| Chatbot Flow large import progress | PASS |
| Chatbot Flow full export valid JSON | PASS |
| Chatbot Flow node media upload and trigger send | PASS |
| Chatbot Flow Triggered/Sent/Failed counters | PASS |
| Group Grabber reload/export CSV correctness | PASS |
| Contact verification | PASS |
| One-target campaign | PASS |
| Warmer start/stop | PASS |

Full Chatbot Flow export performance evidence from authenticated VPS curl: HTTP `200`, `time=14.570861s`, `size=50929353` bytes (49 MB). This is expected for full exports because all flow nodes are included.

## 11. Post-2026-06-16 Runtime Checks

After deploying the auth and Chatbot Flow runtime-scaling changes, add these checks to release evidence:

| Area | Check |
|------|-------|
| Auth token revocation | Login, refresh once, confirm old refresh token is rejected, logout clears cookies, and password change invalidates the previous access token. |
| User lifecycle | Admin can create/update/deactivate users; non-admin routes remain tenant-scoped. |
| Chatbot Flow mapping | New/imported/updated flows create rows in `chatbot_flow_sessions`; inbound messages for one `session_id` do not trigger flows assigned to another session. |
| Query shape | Hot-path inbound matching uses indexed `chatbot_flow_sessions.session_id` lookup; avoid regressions to global active-flow scans. |
