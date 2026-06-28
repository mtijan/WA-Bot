# WA-Bot SaaS Operations Policy

**Status:** Production-readiness decision record  
**Last updated:** 2026-06-28

Dokumen ini merapikan keputusan operasional agar WA-Bot dapat dijalankan sebagai layanan multi-tenant berbayar dengan batas yang jelas. Ini bukan sertifikasi legal atau compliance; gunakan sebagai baseline sebelum pilot berbayar dan lengkapi dengan review hukum/komersial sebelum penjualan publik skala besar.

## 1. Tenant and Admin Model

Keputusan:

- Role `user` adalah tenant biasa. User hanya boleh melihat dan memodifikasi data miliknya sendiri melalui `user_id`.
- Role `admin` adalah operator platform. Admin memiliki visibilitas global untuk support, incident response, user lifecycle, proxy/settings, backup, dan operasi teknis.
- Admin global tidak boleh dipakai sebagai akun tenant harian. Admin hanya dipakai untuk tugas operasional.
- Setiap pelanggan SaaS minimal memiliki satu akun `user`; akun tambahan dibuat hanya jika ada kebutuhan operasional jelas.
- Semua WhatsApp sessions, contacts, templates, campaigns, warmer campaigns, chatbot flows, chatbot AI credentials/settings, delivery logs, opt-outs, monitoring visibility, dan Group Grabber access harus tenant-scoped untuk non-admin.
- Jumlah WhatsApp device yang dapat dibuat user dikontrol admin melalui paket `subscription_plans.max_sessions`; user non-admin ditolak saat mencoba menambah device di atas kuota.
- Menu Monitoring hanya untuk admin/operator platform; user tenant biasa tidak melihat route/menu tersebut.
- API key `X-API-Key` dianggap admin internal server-to-server. Jangan berikan API key ini ke pelanggan atau frontend.
- Dokumentasi HTML pendamping tersedia di `docs/html/saas-operations.html` agar paket dokumen browser selaras dengan decision record ini.

Operational rule:

- Sebelum pelanggan baru aktif, admin membuat akun user, pelanggan login, lalu pelanggan menghubungkan sendiri WhatsApp session miliknya.
- Admin boleh membantu support dengan akses global, tetapi tindakan support harus dicatat di tiket atau audit log.

## 2. Billing and Entitlements

Keputusan fase MVP:

- Billing awal tetap dapat dilakukan manual/off-platform, tetapi entitlement teknis sudah dikontrol di aplikasi melalui `subscription_plans`, `users.plan_id`, `users.subscription_status`, `users.subscription_expires_at`, dan `users.billing_reference`.
- Status pembayaran pelanggan dikelola oleh admin melalui User Management/Plans Management. Fitur runtime menolak operasi berbayar dengan `SUBSCRIPTION_INACTIVE` atau `QUOTA_EXCEEDED` ketika status/kuota tidak valid.
- Jika pelanggan berhenti membayar, admin dapat mengubah `subscription_status` atau menonaktifkan akun user (`is_active=0`). Nonaktif akun mencabut sesi dashboard melalui `token_version` dan refresh-token revocation.
- Jangan menghapus data pelanggan saat suspend kecuali ada permintaan penghapusan atau masa retensi sudah lewat.

Kebutuhan sebelum self-serve SaaS penuh:

- Payment gateway, invoice otomatis, customer portal, dan webhook pembayaran belum diimplementasikan.
- Riwayat invoice/renewal yang lengkap masih perlu dibuat jika ingin self-serve SaaS publik.
- Saat ini enforcement sudah ada untuk session max, campaign bulanan, chatbot flow count, upload media, single-message, dan warmer create action.

## 3. Audit Logging

Keputusan:

- Tindakan sensitif harus memiliki audit trail. Implementasi `audit_logs` append-only sudah tersedia.
- Untuk private paid pilot, tiket/support log tetap disarankan sebagai konteks bisnis tambahan, tetapi audit teknis tetap menjadi sumber bukti aplikasi.

Minimum audit event sebelum public launch:

| Event | Actor | Target | Required fields |
|-------|-------|--------|-----------------|
| Login/logout/refresh failure burst | user/admin | account | timestamp, IP, user agent, result |
| Create/update/deactivate user | admin | user | before/after role and active status |
| Password reset/change | self/admin | user | timestamp, actor, target, no plaintext password |
| Create/delete/reconnect/repair session | user/admin | session | session_id, owner user_id, action result |
| Create/update/delete campaign/template/contact/flow | user/admin | resource | resource id, owner user_id, action |
| Proxy/settings/API key changes | admin | setting/proxy | masked value, actor, timestamp |
| Backup/restore/prune | admin/system | runtime data | result, affected counts, backup id |

Implementation baseline:

- Append-only `audit_logs` table sudah dibuat oleh migration `017_audit_logs`.
- Audit logs tenant-filtered untuk non-admin visibility dan globally visible untuk admin melalui `GET /api/audit-logs`.
- Do not log secrets, refresh tokens, raw provider API keys, full proxy credentials, or WhatsApp session files.

## 4. Backup, Restore, and Retention

Keputusan:

- Runtime data is business-critical and sensitive: `backend/database.sqlite`, `backend/sessions/`, `backend/uploads/`, encrypted backups, and restore drills.
- Encrypted backup is mandatory for paid use.
- Restore drill is mandatory before public launch and at least monthly after launch.
- Offsite encrypted backup is mandatory before public launch. Telegram offsite backup is acceptable for staging/pilot, but object storage or another managed destination is preferred for public SaaS.

Retention baseline:

| Data | Default retention | Notes |
|------|-------------------|-------|
| Delivery logs | `WA_BOT_LOG_RETENTION_DAYS` | Prune with `npm run logs:prune:apply` after backup. |
| Warmer logs | Same pruning cadence as delivery logs | Keep only operationally useful history. |
| Export files | Pruned by log/file pruner | Treat exported contact files as personal data. |
| Uploaded media | Review monthly | Delete unused media when no longer tied to templates/flows. |
| Contacts | Customer-controlled | Delete on customer request or account termination policy. |
| WhatsApp sessions | Active customer lifecycle | Remove on disconnect, termination, or confirmed compromise. |
| Audit logs | 180-365 days for public SaaS | Keep longer only if required by contract/legal basis. |
| Backups | 7 daily + 4 weekly minimum | Keep encryption key separate from backup destination. |

Operational rule:

- Never restore over live runtime data without a rollback copy.
- Never delete session files, database, uploads, exports, or backups unless the exact target is approved.

## 5. Legal, Privacy, and Consent

Keputusan:

- Customers are responsible for lawful contact collection and message consent.
- WA-Bot operator is responsible for protecting tenant isolation, secrets, backups, and platform infrastructure.
- Every customer must accept acceptable-use terms before paid use.
- Customers must provide an opt-out path in outbound campaigns when messages are marketing or non-transactional.
- Scraped, purchased, or non-consented contact lists are prohibited.

Minimum customer-facing terms before public sale:

- Acceptable Use Policy.
- Privacy Policy describing contact data, message logs, uploads, and WhatsApp session handling.
- Data Processing Addendum if serving business customers that require it.
- Support and incident response policy.
- Account suspension/termination and data deletion policy.

## 6. WhatsApp/Baileys Platform Governance

Keputusan:

- Baileys remains an unofficial integration and carries account-blocking and ToS risk.
- Do not market this as an official WhatsApp or Meta product.
- Do not promise guaranteed deliverability or immunity from bans.
- Do not use warmer/bulk features to evade platform abuse controls.
- Business-critical or high-volume customers should be routed to the official WhatsApp Business Platform roadmap.

Operational limits for Baileys-based plans:

- Default daily outbound limits must be conservative per sender number.
- Campaign delays must remain human-like and configurable.
- Opt-out enforcement must remain enabled.
- New sender numbers should use gradual ramp-up and real two-way engagement.
- Repeated spam complaints, bans, or abuse reports should trigger suspension.

## 7. Prioritized Production Gap Notes

Catatan ini mengurutkan kekurangan yang masih tercatat di dokumentasi saat ini. Ini adalah note prioritas, bukan perubahan status production-ready.

| Priority | Area | Current documentation baseline | Next note |
|----------|------|--------------------------------|-----------|
| **DONE** | **Audit log** | `docs/SAAS_OPERATIONS.md` mewajibkan audit trail sebelum public paid SaaS. Implementasi `audit_logs` selesai penuh. | Tabel `audit_logs` append-only aktif. Event ter-cover: `AUTH_*`, `USER_*`, `SESSION_*`, `CAMPAIGN_*`, `TEMPLATE_*`, `CHATBOT_FLOW_*`, `PROXY_*`, `SETTING_SAVE`. Admin view global, non-admin tenant-scoped via `GET /api/audit-logs`. |
| **DONE** | **Billing and entitlement** | Dinonaktifkan manual diganti dynamic quota middleware (`subscription_plans`), Plans Management UI, dan User edit. | Selesai. Kuota dibatasi secara real-time. |
| **DONE** | **Legal/customer policy** | Dokumen hukum lengkap (Terms, Privacy, AUP, Retensi) tersedia dalam format MD dan HTML interaktif di internal modal. | Selesai. Dokumen hukum terbit dan mudah diakses. |
| **DONE** | **Session credential encryption** | Enkripsi at-rest berkas sesi Baileys menggunakan AES-256-GCM telah terintegrasi penuh. | Selesai. Sesi terenkripsi dengan aman di disk. |
| P1 | Backup and retention production target | Encrypted backup, restore drill, dan Telegram offsite aktif untuk staging/pilot; security docs masih menyarankan object storage/managed destination untuk public SaaS. | Tetapkan offsite backup production-grade, restore evidence, retention schedule, dan media lifecycle review. |
| P1 | Production monitoring and incident response | Lightweight Telegram alerting dan staging smoke sudah ada; docs masih meminta review alert dan incident responsibility untuk traffic produksi. | Perluas monitoring sesuai kebutuhan traffic, tetapkan named operator, escalation, dan incident drill. |
| P2 | Platform governance | Baileys risk sudah didokumentasikan dan acceptable-use limits sudah ada. | Pertahankan batas penggunaan pilot, lalu WhatsApp Business Platform path. |

## 8. Launch Gates

Private paid pilot can proceed when:

- Multi-user tenant isolation tests pass.
- Backend tests pass.
- Frontend production build passes.
- OpenAPI route parity is 100%.
- Domain HTTPS, secure cookies, CORS allowlist, firewall, encrypted backup, restore drill, and alerting are verified.
- Admin/operator process for billing, support, suspension, and deletion is documented.

Public SaaS launch requires additionally:

- Production-grade offsite backup destination with restore evidence.
- Evidence that audit logs and entitlement enforcement remain active in the production environment.
- Written customer Terms, Privacy Policy, Acceptable Use Policy, and platform risk disclosure.
- Abuse handling and customer suspension workflow.
- Production incident response runbook with named operator responsibilities.
