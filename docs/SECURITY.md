# WA-Bot Pro Security Baseline

**Status:** Internal development baseline  
**Last updated:** 2026-06-05

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
| Security response headers | Native Express middleware sets baseline headers such as CSP, frame denial, referrer policy, permissions policy, and optional HSTS when secure cookies are enabled. | `backend/src/middleware/security.middleware.js` |
| Request-size policy | Default JSON/urlencoded body limit is configurable and lower than import endpoints. | `WA_BOT_JSON_BODY_LIMIT`, `WA_BOT_IMPORT_BODY_LIMIT` |
| Dependency audit baseline | `sqlite3@6.x` remediation was tested and latest backend audit was clean. | `backend/package.json`, `docs/SECURITY_AUDIT.md` |
| Staging deploy baseline | HTTP/IP staging is verified, but production hardening is pending. | `docs/STAGING.md` |

## 3. Known Production Gaps

| Gap | Risk | Required Action |
|-----|------|-----------------|
| Session credentials are not proven encrypted at-rest | Filesystem access may expose linked WhatsApp sessions. | Apply OS ACLs, encryption at-rest, and session rotation procedures. |
| Existing Chatbot AI keys may predate field encryption | Older SQLite rows may remain plaintext until saved again. | Configure `WA_BOT_SECRET_ENCRYPTION_KEY` and save each AI configuration again. |
| Sensitive examples may drift into docs or source code | Secrets can be leaked accidentally. | Use placeholders only and scan before release. |
| Staging still lacks production network hardening | HTTP/IP exposure without domain/TLS and provider firewall review is not production-safe. | Add domain/TLS, set secure cookie, restrict CORS, review provider firewall, and record HTTPS smoke evidence. |
| Filesystem ACL needs final dedicated-user review | Current staging ACL baseline is applied for the `ubuntu` service user, but the production template assumes a dedicated `wa-bot` user. | Migrate service user later or keep documenting the `ubuntu` staging exception; protect env, database, sessions, backups, and logs. |
| Baileys is an unofficial integration | Account restriction and platform-policy risk remain. | Review WhatsApp policy and evaluate the official Business Platform. |

Implemented backend hardening:

- Optional admin dashboard login controlled by `WA_BOT_ADMIN_USERNAME`, `WA_BOT_ADMIN_PASSWORD`, and `WA_BOT_ADMIN_SESSION_SECRET`.
- Optional `X-API-Key` access controlled by `WA_BOT_API_KEY` for trusted server-to-server callers.
- In-memory API rate limiting controlled by `WA_BOT_RATE_LIMIT_MAX` and `WA_BOT_RATE_LIMIT_WINDOW_MS`.
- Restricted CORS origins controlled by `WA_BOT_ALLOWED_ORIGINS`.
- Disabled Express `X-Powered-By` response header.
- Native security headers for CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, and optional HSTS.
- Request-size policy controlled by `WA_BOT_JSON_BODY_LIMIT` and `WA_BOT_IMPORT_BODY_LIMIT`; import endpoints can be larger than normal API calls.
- Masked Chatbot AI key responses with `has_api_key` metadata.
- Optional AES-256-GCM encryption for newly saved Chatbot AI keys controlled by `WA_BOT_SECRET_ENCRYPTION_KEY`.
- `sqlite3@6.x` upgrade path has been tested and backend dependency audit is currently clean.

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
- Configure `WA_BOT_SECRET_ENCRYPTION_KEY`; move environment keys and IPLocate keys into managed secrets or protected configuration.
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
