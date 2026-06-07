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

## 6. Netdata Native Installation

Instalasi agen pemantau resource Netdata secara native pada sistem operasi host Ubuntu/Debian (tanpa Docker):

1. Jalankan skrip kickstart resmi Netdata secara non-interaktif dan menolak pengiriman telemetry data:

```bash
wget -O /tmp/netdata-kickstart.sh https://get.netdata.cloud/kickstart.sh && sh /tmp/netdata-kickstart.sh --non-interactive --disable-telemetry
```

2. Pastikan service Netdata telah terpasang dan berjalan aktif sebagai service systemd:

```bash
sudo systemctl status netdata --no-pager
```

3. Untuk alasan keamanan, Netdata sebaiknya dikonfigurasi agar hanya mendengarkan pada alamat local loopback (`127.0.0.1`). Konfigurasi ini biasanya berada di `/etc/netdata/netdata.conf`:

```ini
[web]
    bind to = 127.0.0.1
```

Setelah mengubah konfigurasi, restart Netdata:
```bash
sudo systemctl restart netdata
```

4. **Akses Dashboard Secara Aman**: Jangan membuka port `19999` di firewall UFW untuk publik. Gunakan SSH Tunneling dari komputer lokal Anda untuk mengakses dashboard Netdata:

```bash
# Jalankan perintah ini dari terminal komputer lokal Anda
ssh -L 19999:127.0.0.1:19999 user@43.157.224.57
```

Setelah terowongan SSH aktif, Anda dapat membuka dashboard pemantauan resource di browser lokal melalui alamat:
`http://localhost:19999/`

## 6.1 Alur Konfigurasi Alerting Bawaan Netdata

Netdata secara native mendukung pengiriman alert jika penggunaan CPU/RAM/Disk melampaui batas kritis. Untuk mengaktifkan peringatan Telegram langsung dari Netdata:

1. Edit konfigurasi health alarm menggunakan utility bawaan Netdata:

```bash
cd /etc/netdata
sudo ./edit-config health_alarm_notify.conf
```

2. Cari bagian `TELEGRAM` dan sesuaikan nilainya:

```conf
# Enable telegram sending
SEND_TELEGRAM="YES"

# Telegram Bot Token
TELEGRAM_BOT_TOKEN="isi-dengan-token-bot-telegram-anda"

# Chat ID penerima alert
DEFAULT_RECIPIENT_TELEGRAM="isi-dengan-chat-id-tujuan"
```

3. Uji pengiriman alarm notifikasi dari Netdata:

```bash
# Jalankan sebagai user netdata untuk mengetes pengiriman alert
sudo su -s /bin/bash netdata
/usr/libexec/netdata/plugins.d/alarm-notify.sh test
exit
```


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
