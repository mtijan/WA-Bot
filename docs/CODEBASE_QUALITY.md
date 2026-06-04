# WA-Bot Codebase Quality Baseline

**Status:** Baseline implemented, migration across all modules still in progress  
**Last updated:** 2026-06-04

## Implemented Baseline

| Area | Current State | Evidence |
|------|---------------|----------|
| Central config | Core runtime/security/admin/internal values are read through `backend/src/config.js`. | `backend/src/config.js` |
| Structured logger | Pino logger exists for bootstrap/runtime/internal error paths. | `backend/src/logger.js` |
| Error response helper | Shared helpers exist for consistent success/error JSON envelopes. | `backend/src/utils/http_response.js` |
| Frontend API client | Central API request helper exists and auth flow uses it. | `frontend/src/apiClient.js` |

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
