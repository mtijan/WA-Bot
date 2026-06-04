# WA-Bot Pro Messaging and Privacy Baseline

**Status:** Operational policy template  
**Last updated:** 2026-06-01

## 1. Purpose

WA-Bot Pro must only be used for recipients who have provided valid consent. This file is the operational baseline for the suppression controls implemented in the backend.

## 2. Required Records

Maintain a record for every contact source:

| Field | Description |
|-------|-------------|
| Contact identifier | Phone number or internal contact ID |
| Consent source | Form, contract, event registration, or other lawful source |
| Consent timestamp | Date and timezone |
| Allowed message category | Transactional, support, marketing, or another defined category |
| Opt-out timestamp | Date and timezone when the recipient withdrew consent |

## 3. Opt-Out Procedure

1. Publish a clear opt-out instruction in outbound campaign templates.
2. Stop further campaign messages when a recipient requests removal.
3. Record the request in the approved operational suppression list.
4. Remove the recipient from future imported campaign targets.
5. Retain only the minimum record required to honor the suppression request.

Automated enforcement is implemented for private inbound keywords `STOP`, `UNSUBSCRIBE`, and `BERHENTI`. Bulk campaigns skip suppressed numbers. Single-message sending rejects suppressed numbers unless the caller uses an explicit override for a lawful and necessary message. Review the suppression list through `/api/opt-outs`.

## 4. Retention

- Use `WA_BOT_LOG_RETENTION_DAYS` to define the delivery-log retention period.
- Run `npm run logs:prune` in `backend/` to preview deletions.
- Run `npm run logs:prune:apply` only after reviewing the dry-run count and confirming a backup exists.
- Review contact data separately and remove records that no longer have a valid purpose.

## 5. Platform Risk

Baileys is an unofficial WhatsApp integration. Do not use automation to evade platform controls. Evaluate the official WhatsApp Business Platform for business-critical production use.
