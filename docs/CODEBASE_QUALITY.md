# WA-Bot Codebase Quality Baseline

**Status:** Completed  
**Last updated:** 2026-06-16

## Implemented Baseline

| Area | Current State | Evidence |
|------|---------------|----------|
| Central config | Core runtime/security/admin/internal values are read through `backend/src/config.js`. | `backend/src/config.js` |
| Structured logger | Pino logger exists for bootstrap/runtime/internal error paths. | `backend/src/logger.js` |
| Error response helper | Shared helpers exist for consistent success/error JSON envelopes. | `backend/src/utils/http_response.js` |
| Secret masking helper | Shared masking helper exists for proxy URLs and partial secret display. | `backend/src/utils/secret_masking.js` |
| Media upload attachments | Backend upload modules and frontend upload UI for Templates, Single Message, and Chatbot Flow are implemented and verified. | `backend/src/services/upload.service.js`, `backend/src/controllers/upload.controller.js`, `backend/src/routes/upload.routes.js`, `frontend/src/components/MediaUploadField.jsx`, `docs/MEDIA_UPLOAD_WORKLOG.md` |
| Chatbot Flow large-data UX and runtime scaling | Import/body limit is 60 MB, import/export progress is visible, export response validation prevents `null` downloads, list responses avoid large `nodes`, settings saves avoid resending `nodes`, delivery counters are split into trigger/sent/failed, and runtime matching uses normalized `chatbot_flow_sessions` indexed by `session_id` instead of scanning all active flows. | `backend/src/config.js`, `backend/src/controllers/chatbot.controller.js`, `backend/src/services/chatbot_flow_sessions.service.js`, `backend/src/services/whatsapp.service.js`, `backend/src/services/chatbot_ai.service.js`, `frontend/src/components/ChatbotFlows.jsx` |
| JWT multi-user auth hardening | Access/refresh tokens use HttpOnly cookies, refresh tokens are stored by hash/JTI and rotated/revoked, `users.token_version` invalidates old sessions, and route middleware validates active users from the database. | `backend/src/middleware/admin_auth.middleware.js`, `backend/src/controllers/auth.controller.js`, `backend/src/controllers/user.controller.js`, `frontend/src/apiClient.js`, `frontend/src/components/UserManagement.jsx` |
| Multi-tenant query isolation | Core entities are filtered by `user_id`; campaign personalization joins contacts through tenant-owned groups; indexes avoid full table scans as data grows. | `backend/src/controllers/*.js`, `backend/src/services/campaign.service.js`, `backend/src/migrations/index.js`, `backend/test/campaign_service.test.js` |
| Frontend API client | Central API request helper exists; all React components use it. | `frontend/src/apiClient.js`, `frontend/src/components/Dashboard.jsx`, `frontend/src/components/SessionManager.jsx`, `frontend/src/components/ContactGroups.jsx`, `frontend/src/components/ProxyManager.jsx`, `frontend/src/components/Templates.jsx`, `frontend/src/components/ChatbotFlows.jsx`, `frontend/src/components/SingleMessage.jsx`, `frontend/src/components/BulkCampaign.jsx`, `frontend/src/components/Warmer.jsx`, `frontend/src/components/GroupDetail.jsx`, `frontend/src/components/ChatbotAI.jsx` |
| Controller Response & Validation Migration | All 15 backend controllers are fully migrated to use Pino logger, centralized config, consistent response helper, and declarative validation middleware. | `backend/src/controllers/*.js`, `backend/src/routes/*.js`, `backend/src/utils/validator.js` |

## Rules for Future Changes

- Prefer `config` from `backend/src/config.js` over new direct `process.env` reads.
- Prefer `logger` / `logError` over new `console.log` or `console.error` in backend runtime code.
- Prefer `sendError` and `sendSuccess` for new backend endpoints.
- Prefer `validateBody` schema rules in route registration for new payload validation.
- Prefer `apiRequest` from `frontend/src/apiClient.js` for frontend API calls.
- Prefer normalized lookup tables over JSON text scans for hot-path runtime matching.

## Remaining Work

| Gap | Recommended Next Step |
|-----|-----------------------|
| Error response contract is not fully enforced. | Add backend integration tests for common error envelopes. |

---

## Migration Evidence

| Date | Area | Evidence |
|------|------|----------|
| 2026-06-05 | Frontend dashboard API calls | `frontend/src/components/Dashboard.jsx` uses `apiRequest('/dashboard/stats')`; `npm run build` passed. |
| 2026-06-05 | Admin auth responses | `backend/src/controllers/auth.controller.js` uses `sendSuccess` / `sendError`; `node --check .\src\controllers\auth.controller.js` passed. |
| 2026-06-05 | Frontend session API calls | `frontend/src/components/SessionManager.jsx` uses `apiRequest` for session list/create/delete; `npm run build` passed. |
| 2026-06-05 | Frontend template API calls | `frontend/src/components/Templates.jsx` uses `apiRequest` for template list/create/delete; `npm run build` passed. |
| 2026-06-05 | Frontend contact group API calls | `frontend/src/components/ContactGroups.jsx` uses `apiRequest` for group list/create/update/delete and orphan cleanup; `npm run build` passed. |
| 2026-06-05 | Frontend proxy manager API calls | `frontend/src/components/ProxyManager.jsx` uses `apiRequest` for proxy/session/IPLocate/offline-db API calls; `npm run build` passed. |
| 2026-06-05 | Proxy/IPLocate secret masking | Proxy URL responses and IPLocate setting responses are masked; hardcoded IPLocate fallback key was removed; backend syntax checks, `npm run build`, and `npm run security:audit` passed. |
| 2026-06-06 | Media upload completed | `multer`, upload config, upload service/controller/routes, runtime `.gitignore`, WhatsApp uploaded-path resolver, reusable frontend upload component, and integrations for Templates, Single Message, and Chatbot Flow were completed and verified. |
| 2026-06-06 | Frontend chatbot flow API calls | `frontend/src/components/ChatbotFlows.jsx` now uses `apiRequest` for list/session polling, create/update/delete, status toggle, import, and export; `npm run build` passed. |
| 2026-06-06 | Chatbot Flow import/edit performance and metric correction | `WA_BOT_IMPORT_BODY_LIMIT` defaults to `60mb`; `ChatbotFlows.jsx` shows import/export progress; list/detail/settings routes avoid resending large `nodes`; migration `006_chatbot_flow_delivery_metrics` introduces `trigger_count` and `failed_count` and resets `sent_count` to accurate successful-node-message counting. |
| 2026-06-07 | Chatbot Flow staging smoke and export UX | Browser smoke passed for import/export/edit/settings/nodes/media/counters; table layout restored actions visibility by keeping `Sent` per row and aggregate `Triggered`/`Failed` cards above; export validates response and shows download progress so invalid responses do not save `null`. |
| 2026-06-16 | Auth/session revocation hardening | JWT auth now uses database-checked `token_version`, hashed refresh token storage, refresh rotation, logout/password-change revocation, admin-only user management, and 12-character minimum password validation. Backend auth tests pass. |
| 2026-06-16 | Chatbot Flow runtime scaling | Added `chatbot_flow_sessions` migration/service, synced assignments on create/update/import/delete, updated inbound matching and Chatbot AI knowledge lookup to use indexed session lookup, and added tests for mapping/session isolation. Backend test suite passed 78/78 at the time. |
| 2026-06-28 | SaaS user controls | Added admin-controlled `users.device_limit`, backend session quota enforcement, Monitoring visibility restricted to admin, OpenAPI parity 106/106, and documentation parity for Markdown/HTML SaaS operations. Backend test suite passes 81/81. |
| 2026-06-06 | Frontend SingleMessage API calls | `frontend/src/components/SingleMessage.jsx` now uses `apiRequest` for sessions, templates, contact groups, groups list, and sending messages; `npm run build` passed. |
| 2026-06-06 | All remaining frontend components | `BulkCampaign.jsx`, `Warmer.jsx`, `GroupDetail.jsx`, `GroupGrabber.jsx`, and `ChatbotAI.jsx` successfully migrated to `apiRequest` for all network calls; `npm run build` passed and Production API URL guard verified. |
| 2026-06-06 | Backend controllers & validation migration | All 15 controllers refactored to use `sendSuccess`/`sendError` response helpers, logging converted from `console.*` to `logger`/`logError`, and route payload validation middleware `validator.js` created and integrated across all routes. Syntax loop and frontend build verified. |
