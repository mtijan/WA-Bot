# WA-Bot External Alerting Command Sheet

**Status:** Ready-to-apply template  
**Last updated:** 2026-06-06  
**Target:** Ubuntu 24.04 staging/production VPS

This command sheet installs a lightweight WA-Bot alert timer. It checks API readiness, worker readiness, public HTTPS, disk usage, and encrypted-backup freshness, then sends an alert through Telegram and/or a generic external webhook when something fails.

Use this as the minimal alert baseline while a full Uptime Kuma/Netdata deployment is still pending.

## 1. Required Secret

Choose at least one notification target.

Telegram native mode:

- `WA_BOT_ALERT_TELEGRAM_BOT_TOKEN`
- `WA_BOT_ALERT_TELEGRAM_CHAT_ID`

Generic webhook mode:

- Uptime Kuma notification webhook receiver
- Discord webhook
- Slack webhook
- Custom n8n/Make/Zapier webhook
- Your own alert API via `WA_BOT_ALERT_WEBHOOK_URL`

Do **not** commit Telegram tokens, chat IDs, or webhook URLs. Store them only in `/etc/wa-bot/wa-bot.env`.

## 2. Configure Env

Run inside the VPS:

```bash
sudo grep -q '^WA_BOT_ALERT_TELEGRAM_BOT_TOKEN=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ALERT_TELEGRAM_BOT_TOKEN=replace-with-telegram-bot-token' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_ALERT_TELEGRAM_CHAT_ID=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ALERT_TELEGRAM_CHAT_ID=replace-with-telegram-chat-id' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_ALERT_WEBHOOK_URL=' /etc/wa-bot/wa-bot.env || echo '# WA_BOT_ALERT_WEBHOOK_URL=replace-with-external-webhook-url' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_ALERT_PUBLIC_URL=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ALERT_PUBLIC_URL=https://stagingwabot.web.id/' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_ALERT_PUBLIC_HEALTH_URL=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ALERT_PUBLIC_HEALTH_URL=https://stagingwabot.web.id/health' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_ALERT_BACKUP_MAX_AGE_HOURS=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ALERT_BACKUP_MAX_AGE_HOURS=36' | sudo tee -a /etc/wa-bot/wa-bot.env
sudo grep -q '^WA_BOT_ALERT_DISK_WARN_PERCENT=' /etc/wa-bot/wa-bot.env || echo 'WA_BOT_ALERT_DISK_WARN_PERCENT=80' | sudo tee -a /etc/wa-bot/wa-bot.env
```

Edit the Telegram values:

```bash
sudo nano /etc/wa-bot/wa-bot.env
```

To find Telegram chat ID:

1. Send any message to the bot or the Telegram group where the bot is a member.
2. Run this command on your own machine or VPS, replacing the token through env so it is not stored in shell history:

```bash
read -s TELEGRAM_BOT_TOKEN
curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
unset TELEGRAM_BOT_TOKEN
```

Look for `message.chat.id`. Group IDs are often negative.

## 3. Manual Check

```bash
cd /opt/wa-bot/backend
set -a
. /etc/wa-bot/wa-bot.env
set +a
npm run monitor:alert
```

Expected healthy output:

```json
{
  "status": "ok",
  "checks": [
    { "ok": true, "target": "api-ready", "message": "ok" }
  ]
}
```

The real output includes all check results. If any check fails, the command exits non-zero and sends a Telegram/webhook alert depending on configured env values.

## 4. Create systemd Service

```bash
sudo tee /etc/systemd/system/wa-bot-alertcheck.service >/dev/null <<'EOF'
[Unit]
Description=WA-Bot external alert healthcheck
Wants=wa-bot-api.service wa-bot-worker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/wa-bot/backend
EnvironmentFile=/etc/wa-bot/wa-bot.env
ExecStart=/usr/bin/npm run monitor:alert
User=ubuntu
Group=ubuntu
EOF
```

If services later run as a dedicated `wa-bot` user, update `User=` and `Group=` consistently.

## 5. Create systemd Timer

```bash
sudo tee /etc/systemd/system/wa-bot-alertcheck.timer >/dev/null <<'EOF'
[Unit]
Description=Run WA-Bot external alert healthcheck every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true
Unit=wa-bot-alertcheck.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wa-bot-alertcheck.timer
systemctl list-timers wa-bot-alertcheck.timer --no-pager
```

## 6. Test Alert

To force a safe test alert without stopping production services, temporarily set a bad public health URL:

```bash
cd /opt/wa-bot/backend
set -a
. /etc/wa-bot/wa-bot.env
set +a
WA_BOT_ALERT_PUBLIC_HEALTH_URL=https://stagingwabot.web.id/__force_alert_test__ npm run monitor:alert
```

Confirm the Telegram or external notification arrives.

## 7. Check Logs

```bash
sudo systemctl start wa-bot-alertcheck.service
sudo journalctl -u wa-bot-alertcheck.service -n 120 --no-pager
sudo systemctl status wa-bot-alertcheck.timer --no-pager
```

## 8. Evidence To Record

Update these files after the test alert is confirmed:

- `docs/MONITORING.md`
- `docs/STAGING.md`
- `sdlc_documentation.md`
- `checklist.html`
- `AGENTS.md`

Record:

- alert channel type, without Telegram token/chat ID or secret URL;
- timer status;
- latest healthy check result;
- forced test alert timestamp;
- operator name;
- remaining gaps, if any.
