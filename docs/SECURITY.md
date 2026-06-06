# WA-Bot Pro Security Baseline

**Status:** Internal development baseline  
**Last updated:** 2026-06-06

## 1. Scope

This document separates implemented controls from production requirements. It is not a security certification.

## 2. Current Controls

| Area | Current State | Evidence |
|------|---------------|----------|
| SQL query handling | Parameterized SQLite statements are used in application data access. | `backend/src/database.js` and controllers |
| Session credential location | Baileys auth files are stored under the backend directory, outside the frontend webroot. | `backend/sessions/` |
| AI API key visual masking | The Chatbot AI UI uses a password input field. | `frontend/src/components/ChatbotAI.jsx` |
| Error handling | Express has a final error middleware. | `backend/src/index.js` |
| Admin dashboard authentication | Optional admin login issues an HttpOnly cookie when `WA_BOT_ADMIN_PASSWORD` is configured. | `backend/src/routes/auth.routes.js`, `frontend/src/components/Login.jsx` |
| Security response headers | Native Express middleware sets baseline headers such as tuned CSP (allowing Google Fonts and staging/production websocket), frame denial, referrer policy, permissions policy, and optional HSTS. | `backend/src/middleware/security.middleware.js` |
| Request-size policy | Default JSON/urlencoded body limit is configurable and lower than import endpoints. | `WA_BOT_JSON_BODY_LIMIT`, `WA_BOT_IMPORT_BODY_LIMIT` |
| Media upload limits | Admin image/video upload is implemented with explicit size limits and runtime storage outside git. | `WA_BOT_MEDIA_UPLOAD_DIR`, `WA_BOT_IMAGE_UPLOAD_MAX_BYTES`, `WA_BOT_VIDEO_UPLOAD_MAX_BYTES`, `backend/uploads/` |
| Proxy/IPLocate secret masking | Proxy URLs and IPLocate settings responses no longer return credential plaintext; IPLocate env key is preferred for production. | `backend/src/utils/secret_masking.js`, `backend/src/controllers/proxy.controller.js`, `backend/src/controllers/session.controller.js`, `WA_BOT_IPLOCATE_API_KEY` |
| Dependency audit baseline | `sqlite3@6.x` remediation was tested and latest backend audit was clean (`npm run security:audit`, 2026-06-05). | `backend/package.json`, `docs/SECURITY_AUDIT.md` |
| Staging deploy baseline | HTTP/IP staging is verified, but production hardening is pending. | `docs/STAGING.md` |

## 3. Known Production Gaps

| Gap | Risk | Required Action |
|-----|------|-----------------|
| Session credentials are not proven encrypted at-rest | Filesystem access may expose linked WhatsApp sessions. | Apply OS ACLs, encryption at-rest, and session rotation procedures. |
| Existing Chatbot AI keys may predate field encryption | Older SQLite rows may remain plaintext until saved again. | Configure `WA_BOT_SECRET_ENCRYPTION_KEY` and save each AI configuration again. |
| Sensitive examples may drift into docs or source code | Secrets can be leaked accidentally. | Use placeholders only and scan before release. |
| Production alerting is still lightweight | Domain HTTPS, secure cookie, restricted CORS, provider firewall review, manual browser smoke, Telegram alert timer healthy runs, and forced API readiness alert evidence are complete on staging. | Keep the timer active, review alert logs, and add Uptime Kuma/Netdata or equivalent if production needs deeper CPU/RAM/session alerting. |
| Filesystem ACL needs final dedicated-user review | Current staging ACL baseline is applied for the `ubuntu` service user, but the production template assumes a dedicated `wa-bot` user. | Migrate service user later or keep documenting the `ubuntu` staging exception; protect env, database, sessions, backups, and logs. |
| Offsite backup destination not selected | Local encrypted backups protect against app mistakes, but not VPS loss. | Add offsite/object storage copy when a storage destination is available; keep backup encryption key separate. |
| Uploaded media lifecycle not finalized | Uploaded files may contain personal or business-sensitive content and can grow storage over time. | Finish retention/deletion policy, include uploads in backup only when needed, and keep `/api/uploads/*` behind admin auth/reverse proxy. |
| Baileys is an unofficial integration | Account restriction and platform-policy risk remain. | Review WhatsApp policy and evaluate the official Business Platform. |

Implemented backend hardening:

- Optional admin dashboard login controlled by `WA_BOT_ADMIN_USERNAME`, `WA_BOT_ADMIN_PASSWORD`, and `WA_BOT_ADMIN_SESSION_SECRET`.
- Optional `X-API-Key` access controlled by `WA_BOT_API_KEY` for trusted server-to-server callers.
- In-memory API rate limiting controlled by `WA_BOT_RATE_LIMIT_MAX` and `WA_BOT_RATE_LIMIT_WINDOW_MS`.
- Restricted CORS origins controlled by `WA_BOT_ALLOWED_ORIGINS`.
- Disabled Express `X-Powered-By` response header.
- Native security headers for CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, and optional HSTS.
- Request-size policy controlled by `WA_BOT_JSON_BODY_LIMIT` and `WA_BOT_IMPORT_BODY_LIMIT`; import endpoints can be larger than normal API calls.
- Media upload is implemented. Limits are image <= 5 MB and video <= 10 MB, stored under `backend/uploads/` or `WA_BOT_MEDIA_UPLOAD_DIR`.
- Masked Chatbot AI key responses with `has_api_key` metadata.
- Optional AES-256-GCM encryption for newly saved Chatbot AI keys controlled by `WA_BOT_SECRET_ENCRYPTION_KEY`.
- `sqlite3@6.x` upgrade path has been tested and backend dependency audit is currently clean.
- Staging placeholder secrets were rotated and auth HTTPS smoke passed without exposing secret values.
- Proxy URLs and IPLocate API key responses are masked; the previous hardcoded IPLocate fallback key was removed in favor of `WA_BOT_IPLOCATE_API_KEY` or protected settings.
- Multi-process Rate Limiting: Evaluated options for multi-instance scaling. For single-instance staging VPS, the in-memory rate limiter is active and sufficient. For multi-instance production, it is recommended to offload rate limiting to Caddy reverse proxy plugins or a shared Redis database cache.
- Dedicated User and Filesystem ACL: Staging VPS filesystem permissions are hardened for the active `ubuntu` service user (env file set to `640`, database and sessions restricted to `ubuntu` group). A dedicated `wa-bot` service user template is documented for production migrations in `docs/deploy/security_acl.commands.txt`.

The browser must not embed `WA_BOT_API_KEY` in frontend JavaScript. For public deployment, configure admin login or place the dashboard behind an authenticated reverse proxy. The API key path is suitable for trusted server-to-server access.

## 4. Minimum Production Checklist

- Bind the backend to a private interface or protect it behind a reverse proxy.
- Terminate TLS at the reverse proxy.
- Set `WA_BOT_COOKIE_SECURE=true` after HTTPS is active.
- Configure `WA_BOT_ADMIN_PASSWORD` and `WA_BOT_ADMIN_SESSION_SECRET`, or use a stronger authenticated gateway for every `/api/*` route.
- Configure `WA_BOT_API_KEY` only for trusted server-to-server clients.
- Configure and verify rate limiting, request size limits, and restricted CORS origins.
- Run `npm run security:audit` from `backend/` and record the output in `docs/SECURITY_AUDIT.md`.
- Encrypt disks and restrict access to `backend/sessions/` and `backend/database.sqlite`.
- Apply or adapt `docs/deploy/security_acl.commands.txt` on the VPS.
- Configure `WA_BOT_SECRET_ENCRYPTION_KEY`; move environment keys and IPLocate keys into managed secrets or protected configuration. Prefer `WA_BOT_IPLOCATE_API_KEY` over saving the IPLocate key in SQLite settings for production.
- Remove stale sessions promptly after staff changes or suspected compromise.
- Back up the SQLite database and test restore procedures.
- Record security test evidence for each release candidate.

See `docs/PRIVACY.md` for consent, opt-out, and retention requirements.

## 5. Messaging and Privacy Rules

- Send outbound messages only to recipients who have given consent.
- Provide and honor an opt-out process.
- Do not use account warmer or bulk messaging to evade platform controls.
- Minimize stored contact data and define a retention period for delivery logs.
- Delete contact data when it is no longer required.

## 6. Incident Response

If a session or API key may be compromised:

1. Stop the backend process.
2. Disconnect the affected linked WhatsApp device from the phone.
3. Rotate provider keys and proxy credentials.
4. Archive logs needed for investigation without exposing secrets.
5. Remove compromised local auth files only after confirming the exact session directory.
6. Restore service and document the incident timeline.
