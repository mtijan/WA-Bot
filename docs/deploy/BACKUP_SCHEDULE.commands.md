# WA-Bot Encrypted Backup Schedule Command Sheet

**Status:** Manual command sheet for VPS backup scheduling  
**Last updated:** 2026-06-05  
**Target:** Ubuntu 24.04 staging/production VPS

This command sheet schedules encrypted runtime backups for `backend/database.sqlite`, `backend/sessions/`, and runtime files included by the backup script. If media upload is enabled, decide whether `backend/uploads/` must be preserved as business assets. It does not restore over live data. Restore drills are non-destructive and write into `WA_BOT_RESTORE_DRILL_DIR`.

Run these commands **inside the VPS** as the sudo user.

## 1. Confirm Backup Env

```bash
sudo grep -E '^(WA_BOT_BACKUP_ENCRYPTION_KEY|WA_BOT_ENCRYPTED_BACKUP_DIR|WA_BOT_RESTORE_DRILL_DIR)=' /etc/wa-bot/wa-bot.env
```

If `WA_BOT_BACKUP_ENCRYPTION_KEY` is missing or still a placeholder:

```bash
BACKUP_KEY=$(openssl rand -hex 32)
sudo sed -i "s|^WA_BOT_BACKUP_ENCRYPTION_KEY=.*|WA_BOT_BACKUP_ENCRYPTION_KEY=$BACKUP_KEY|" /etc/wa-bot/wa-bot.env
unset BACKUP_KEY
```

Recommended paths:

```bash
sudo grep -q '^WA_BOT_ENCRYPTED_BACKUP_DIR=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ENCRYPTED_BACKUP_DIR=/opt/wa-bot/encrypted_backups' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_RESTORE_DRILL_DIR=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_RESTORE_DRILL_DIR=/opt/wa-bot/restore_drills' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo mkdir -p /opt/wa-bot/encrypted_backups /opt/wa-bot/restore_drills
sudo chmod 750 /opt/wa-bot/encrypted_backups /opt/wa-bot/restore_drills
```

## 2. Manual Backup Test

```bash
cd /opt/wa-bot/backend
set -a
. /etc/wa-bot/wa-bot.env
set +a
npm run backup:encrypted
find "${WA_BOT_ENCRYPTED_BACKUP_DIR:-/opt/wa-bot/encrypted_backups}" -maxdepth 2 -type f -name manifest.json | sort | tail -n 3
```

## 3. Manual Restore Drill Test

```bash
cd /opt/wa-bot/backend
set -a
. /etc/wa-bot/wa-bot.env
set +a
npm run restore:drill
find "${WA_BOT_RESTORE_DRILL_DIR:-/opt/wa-bot/restore_drills}" -maxdepth 2 -type f -name database.sqlite | sort | tail -n 3
```

## 4. Create Daily Backup Service

```bash
sudo tee /etc/systemd/system/wa-bot-backup.service >/dev/null <<'EOF'
[Unit]
Description=WA-Bot encrypted runtime backup
Wants=wa-bot-api.service wa-bot-worker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/wa-bot/backend
EnvironmentFile=/etc/wa-bot/wa-bot.env
ExecStart=/usr/bin/npm run backup:encrypted
User=ubuntu
Group=ubuntu
EOF
```

If services later run as dedicated `wa-bot`, change `User=` and `Group=` consistently.

## 5. Create Daily Backup Timer

```bash
sudo tee /etc/systemd/system/wa-bot-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Run WA-Bot encrypted runtime backup daily

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
Unit=wa-bot-backup.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wa-bot-backup.timer
systemctl list-timers wa-bot-backup.timer --no-pager
```

## 6. Create Weekly Restore Drill

```bash
sudo tee /etc/systemd/system/wa-bot-restore-drill.service >/dev/null <<'EOF'
[Unit]
Description=WA-Bot encrypted backup restore drill

[Service]
Type=oneshot
WorkingDirectory=/opt/wa-bot/backend
EnvironmentFile=/etc/wa-bot/wa-bot.env
ExecStart=/usr/bin/npm run restore:drill
User=ubuntu
Group=ubuntu
EOF

sudo tee /etc/systemd/system/wa-bot-restore-drill.timer >/dev/null <<'EOF'
[Unit]
Description=Run WA-Bot restore drill weekly

[Timer]
OnCalendar=Sun 03:00:00
Persistent=true
Unit=wa-bot-restore-drill.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wa-bot-restore-drill.timer
systemctl list-timers 'wa-bot-*' --no-pager
```

## 6.1 Create Daily Pruner Service & Timer

Jadwalkan pembersihan log lama (`delivery_logs`, `warmer_logs`, file ekspor usang) dan perampingan ukuran database SQLite (`VACUUM`) secara otomatis setiap hari pada pukul **02:00** (30 menit sebelum skrip backup harian berjalan pada pukul **02:30**):

```bash
sudo tee /etc/systemd/system/wa-bot-prune.service >/dev/null <<'EOF'
[Unit]
Description=WA-Bot automatic database and logs prune

[Service]
Type=oneshot
WorkingDirectory=/opt/wa-bot/backend
EnvironmentFile=/etc/wa-bot/wa-bot.env
ExecStart=/usr/bin/npm run logs:prune:apply
User=ubuntu
Group=ubuntu
EOF

sudo tee /etc/systemd/system/wa-bot-prune.timer >/dev/null <<'EOF'
[Unit]
Description=Run WA-Bot database and logs prune daily

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
Unit=wa-bot-prune.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wa-bot-prune.timer
systemctl list-timers 'wa-bot-*' --no-pager
```


## 7. Check Logs

```bash
sudo systemctl start wa-bot-backup.service
sudo journalctl -u wa-bot-backup.service -n 80 --no-pager
sudo systemctl start wa-bot-restore-drill.service
sudo journalctl -u wa-bot-restore-drill.service -n 80 --no-pager
```

## 8. Offsite Copy Configuration (Telegram Integration)

The backup system has built-in support for offsite backup copying using the Telegram Bot API (`sendDocument` endpoint). When `WA_BOT_ALERT_TELEGRAM_BOT_TOKEN` and `WA_BOT_ALERT_TELEGRAM_CHAT_ID` are configured in `/etc/wa-bot/wa-bot.env`, the backup script (`npm run backup:encrypted`) automatically packages the encrypted backup folder into a `.tar.gz` archive, uploads it to the specified Telegram chat, and cleans up the temporary archive.

To enable Telegram offsite backup, ensure these environment variables are set in `/etc/wa-bot/wa-bot.env`:

```bash
WA_BOT_ALERT_TELEGRAM_BOT_TOKEN=your_bot_token
WA_BOT_ALERT_TELEGRAM_CHAT_ID=your_chat_id
```

If Telegram credentials are not configured, the backup script will log a notice and skip the offsite upload, keeping the encrypted backup locally only.

Do not copy `WA_BOT_BACKUP_ENCRYPTION_KEY` into the same destination as the encrypted backups.

## 9. Evidence To Record

Record these into `docs/STAGING.md`, `docs/MONITORING.md`, and the release checklist:

* backup timer enabled;
* latest backup path;
* encrypted file count;
* restore drill log result;
* SQLite table count from restore drill;
* whether uploaded media under `backend/uploads/` is included, excluded, or governed by a separate retention rule;
* offsite copy Telegram upload confirmation.
