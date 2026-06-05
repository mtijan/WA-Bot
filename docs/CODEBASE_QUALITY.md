# WA-Bot Codebase Quality Baseline

**Status:** Baseline implemented, migration across all modules still in progress  
**Last updated:** 2026-06-05

## Implemented Baseline

| Area | Current State | Evidence |
|------|---------------|----------|
| Central config | Core runtime/security/admin/internal values are read through `backend/src/config.js`. | `backend/src/config.js` |
| Structured logger | Pino logger exists for bootstrap/runtime/internal error paths. | `backend/src/logger.js` |
| Error response helper | Shared helpers exist for consistent success/error JSON envelopes. | `backend/src/utils/http_response.js` |
| Frontend API client | Central API request helper exists; auth flow, dashboard stats, session manager, and message templates use it. | `frontend/src/apiClient.js`, `frontend/src/components/Dashboard.jsx`, `frontend/src/components/SessionManager.jsx`, `frontend/src/components/Templates.jsx` |
| Auth response helper migration | Admin auth controller uses `sendSuccess` / `sendError`. | `backend/src/controllers/auth.controller.js` |

## Rules for Future Changes

- Prefer `config` from `backend/src/config.js` over new direct `process.env` reads.
- Prefer `logger` / `logError` over new `console.log` or `console.error` in backend runtime code.
- Prefer `sendError` and `sendSuccess` for new backend endpoints.
- Prefer `apiRequest` from `frontend/src/apiClient.js` for frontend API calls.
- Keep old controllers working, but migrate them opportunistically when touching the file for real feature work.

## Remaining Work

| Gap | Recommended Next Step |
|-----|-----------------------|
| Many controllers still return inline JSON errors. | Migrate module by module to `sendError` / `sendSuccess`. |
| Request validation is still manual in controllers. | Add lightweight validation helpers or a schema validator such as Zod/Joi after dependency decision. |
| Backend logs still use `console.*` in services/controllers. | Replace high-volume runtime logs first: WhatsApp service, campaign worker, warmer worker. |
| Frontend components still call `fetch` directly. | Move API calls gradually into `apiRequest` or resource-specific API modules. |
| Error response contract is not fully enforced. | Add backend integration tests for common error envelopes. |

Do not mark item 7 as DONE until the remaining work above is migrated and verified.

## Migration Evidence

| Date | Area | Evidence |
|------|------|----------|
| 2026-06-05 | Frontend dashboard API calls | `frontend/src/components/Dashboard.jsx` uses `apiRequest('/dashboard/stats')`; `npm run build` passed. |
| 2026-06-05 | Admin auth responses | `backend/src/controllers/auth.controller.js` uses `sendSuccess` / `sendError`; `node --check .\src\controllers\auth.controller.js` passed. |
| 2026-06-05 | Frontend session API calls | `frontend/src/components/SessionManager.jsx` uses `apiRequest` for session list/create/delete; `npm run build` passed. |
| 2026-06-05 | Frontend template API calls | `frontend/src/components/Templates.jsx` uses `apiRequest` for template list/create/delete; `npm run build` passed. |

## Current Priority Note

As of 2026-06-05, staging VPS baseline is verified with domain HTTPS, secure cookie/CORS, UFW, local backup/restore timers, local healthcheck, logrotate, HTTP/HTTPS smoke, and auth HTTPS smoke. Continue codebase-quality migration while the remaining production blockers wait on provider firewall review, external alerting, manual browser smoke evidence, and offsite backup later when a storage destination is available.
