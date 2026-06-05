# WA-Bot VPS Monitoring Setup Command Sheet

**Status:** Manual command sheet for monitoring setup  
**Last updated:** 2026-06-05  
**Target:** Ubuntu 24.04 staging/production VPS

This sheet defines the minimal monitoring baseline. It does not prescribe one vendor, but it gives commands and checks for systemd, endpoints, logs, and backup freshness.

Run these commands **inside the VPS** unless noted otherwise.

## 1. Baseline Health Checks

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/health/ready
TOKEN=$(sudo grep '^WA_BOT_INTERNAL_TOKEN=' /etc/wa-bot/wa-bot.env | cut -d= -f2-)
curl -fsS http://127.0.0.1:3002/internal/health/ready -H "X-Internal-Token: $TOKEN"
```

If a domain is already active:

```bash
DOMAIN="staging.example.com"
curl -fsS "https://$DOMAIN/"
curl -fsS "https://$DOMAIN/api/auth/me"
curl -fsS "https://$DOMAIN/health"
```

## 2. Process Checks

```bash
systemctl is-active wa-bot-api
systemctl is-active wa-bot-worker
systemctl is-active caddy
sudo journalctl -u wa-bot-api -n 80 --no-pager
sudo journalctl -u wa-bot-worker -n 80 --no-pager
sudo journalctl -u caddy -n 80 --no-pager
```

## 3. Resource Checks

```bash
df -h /
free -h
uptime
du -sh /opt/wa-bot/backend /opt/wa-bot/encrypted_backups 2>/dev/null || true
```

Alert thresholds:

| Resource | Warning | Critical |
|----------|---------|----------|
| Disk | `>=80%` | `>=90%` |
| RAM | sustained `>=85%` | sustained `>=95%` |
| API/worker | not active for 2-3 minutes | not active for 5 minutes |
| Backup freshness | no daily backup | no backup in 48 hours |

## 4. Backup Freshness Check

```bash
BACKUP_DIR=$(sudo grep '^WA_BOT_ENCRYPTED_BACKUP_DIR=' /etc/wa-bot/wa-bot.env | cut -d= -f2-)
BACKUP_DIR=${BACKUP_DIR:-/opt/wa-bot/encrypted_backups}
find "$BACKUP_DIR" -maxdepth 2 -type f -name manifest.json -printf '%TY-%Tm-%Td %TH:%TM %p\n' | sort | tail -n 5
```

If this command returns no `manifest.json`, run the backup schedule sheet first.

## 5. Uptime Kuma Monitor Targets

Create these monitors in Uptime Kuma or an equivalent tool:

| Name | Type | URL | Interval | Retry |
|------|------|-----|----------|-------|
| `wa-bot-api-live` | HTTP | `http://127.0.0.1:3001/health` | 60s | 3 |
| `wa-bot-api-ready` | HTTP | `http://127.0.0.1:3001/health/ready` | 60s | 3 |
| `wa-bot-worker-ready` | HTTP | `http://127.0.0.1:3002/internal/health/ready` | 60s | 3 |
| `wa-bot-public-frontend` | HTTP(s) | `https://<domain>/` | 60s | 3 |
| `wa-bot-public-auth` | HTTP(s) | `https://<domain>/api/auth/me` | 60s | 3 |

For the internal worker readiness monitor, configure header:

```text
X-Internal-Token: <WA_BOT_INTERNAL_TOKEN>
```

Do not expose port `3002` publicly just to monitor it. Run the monitor on the VPS/private network or use a local script monitor.

## 6. Netdata Or Equivalent

Install a resource monitor only after deciding the monitoring tool and alert channel. Minimum resource alerts:

* disk `/` warning `80%`, critical `90%`;
* RAM sustained `85%`;
* CPU/load sustained high for 10 minutes;
* process down for `wa-bot-api`, `wa-bot-worker`, and `caddy`;
* backup freshness stale.

## 7. Test Notification

Before marking monitoring complete, intentionally send a test alert through the chosen notification channel.

Record:

* monitor tool;
* notification channel;
* API live result;
* API ready result;
* worker ready result;
* disk/RAM alert configured;
* backup freshness alert configured;
* test notification timestamp.

## 8. Evidence Destination

Fill the evidence table in `docs/MONITORING.md` and summarize the result in `docs/STAGING.md`.
