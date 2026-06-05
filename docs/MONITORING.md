# WA-Bot Monitoring & Alert Template

**Status:** Template siap pakai; local healthcheck aktif di staging, external alerting belum dipasang  
**Last updated:** 2026-06-05

Dokumen ini menjadi acuan monitoring sebelum deploy publik. Targetnya adalah memastikan proses mati, endpoint tidak ready, disk penuh, sesi WhatsApp putus, campaign macet, dan backup gagal bisa diketahui sebelum berdampak ke pengguna.

For VPS command steps, use `docs/deploy/MONITORING_SETUP.commands.md`.

## 1. Monitoring Targets

| Target | URL / Command | Expected | Alert If |
|--------|---------------|----------|----------|
| API liveness | `GET http://127.0.0.1:3001/health` | HTTP `200` | HTTP bukan `200` selama 2-3 menit |
| API readiness | `GET http://127.0.0.1:3001/health/ready` | JSON `status=ready` | HTTP `503` atau `status!=ready` |
| Session manager readiness | `GET http://127.0.0.1:3002/internal/health/ready` | JSON `status=ready` | HTTP `503` atau proses tidak merespons |
| Combined worker readiness | `GET http://127.0.0.1:3002/internal/health/ready` | JSON `status=ready` | Worker tidak merespons |
| Campaign worker readiness | `GET http://127.0.0.1:3003/internal/health/ready` | JSON `status=ready` | Worker granular tidak merespons |
| Warmer worker readiness | `GET http://127.0.0.1:3004/internal/health/ready` | JSON `status=ready` | Worker granular tidak merespons |
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

## 3. Netdata / Resource Alerts

Recommended thresholds:

| Resource | Warning | Critical | Action |
|----------|---------|----------|--------|
| Disk used | `>=80%` | `>=90%` | Prune logs, move backups off VPS, expand disk |
| RAM used | `>=85%` sustained | `>=95%` sustained | Restart leaking process, reduce sessions, inspect Baileys |
| CPU load | sustained high load 10m | sustained high load 20m | Inspect worker loop and campaign throughput |
| SQLite size | unusual growth | disk risk | Run retention jobs and inspect logs |

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
| Secure cookie/CORS | `WA_BOT_COOKIE_SECURE=true` and domain-specific `WA_BOT_ALLOWED_ORIGINS` applied on staging |

Monitoring is still **PARTIAL** because external alerting such as Uptime Kuma/Netdata notification has not been installed and tested yet. Next required evidence: external API readiness alert, external worker readiness alert, disk/RAM alert notification, backup freshness alert notification, and test notification. Use `docs/deploy/MONITORING_SETUP.commands.md` as the command checklist.
