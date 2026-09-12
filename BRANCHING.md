# WA-Bot Branch Strategy

Updated: 2026-09-12

## Branch responsibilities

| Branch | Purpose | Allowed content | Base/key commit |
|---|---|---|---|
| `main` | Current shared baseline | Only changes that passed the agreed merge and release gates | `63c93c6` at separation time |
| `release/rag-merge-ready` | RAG implementation candidate for review and merge into `main` | Runtime code, migrations, configuration examples, UI changes, and automated tests that passed local validation | Core implementation through RAG-0613 (Fase 6 Runtime AI Integration complete 13/13); use the reviewed branch-tip SHA |
| `develop/rag-experiments` | Ongoing RAG development and paid/offline experiments | Everything from the release candidate plus provider probes, free-form test runners, development-only commands, and experiment notes | Experiment tooling plus core implementation through RAG-0613 (Fase 6 complete 13/13); use the reviewed branch-tip SHA |
| `hotfix/urgent-fixes` | Urgent production/staging bug fixes | The smallest isolated fix and its focused regression test; no unfinished RAG or experiment files | Directly from `origin/main` at `63c93c6` |

The three branches were published to `origin` on 2026-09-11 after explicit approval. Publishing the refs did not merge or deploy them, and `origin/main` remained at `63c93c6`. Branch names are not deployment evidence; deploy and rollback must always use a reviewed explicit commit SHA.

Current local milestone on 2026-09-12: RAG-0611–RAG-0613 are complete and Fase 6 Runtime AI Integration is finished at 13/13. Milestones include per-session rollout gating (all/allowlist/disabled), zero-AI flow match regression verification, pre-send delivery access recheck against tenant/session lifecycle, bounded inbound message deduplication (60s TTL / 5k entries), and sensitive debug log redaction. Runtime/provider/usage 44/44, full backend 323/323, frontend production build, and route/OpenAPI parity 120/120 passed. These are LOCAL/GIT candidate facts only; runtime migration, real provider/WhatsApp delivery, staging deploy, UAT, and merge to `main` have not occurred.

## Separation rules

RAG-0611–RAG-0613 completes Fase 6 with session rollout control, delivery access guards, bounded deduplication, and inbound log sanitization. Real provider and WhatsApp requests remain zero in the local fixture evaluation. No schema migration was added.

### Release candidate

`release/rag-merge-ready` must not contain:

- `backend/scripts/probe_chatbot_ai_provider.js`;
- `backend/scripts/probe_chatbot_ai_rag_development.js`;
- npm scripts `test:ai-provider`, `test:rag-development`, or `test:rag-freeform-development`;
- `apiDevelopment.txt`, `ChatBot-Flow (2).json`, or `PersonaChatBot.txt`;
- raw experiment transcripts, credentials, runtime databases, sessions, uploads, backups, or exports.

The current release candidate passed local backend, frontend, route/OpenAPI, and documentation validation. It is ready for code review and merge consideration, but it is **not yet approved for staging or production deployment**. Migrations 024–026 still require protected-copy preflight, backup/restore evidence, an approved rollout, staging smoke, and UAT as applicable.

### Development and experiments

Run provider and free-form experiments only from `develop/rag-experiments`. Local source snapshots and credentials remain ignored. Only sanitized aggregates or explicitly authorized sanitized chat/reply evidence may be recorded.

Promote a change to the release branch by selecting reviewed implementation commits. Do not merge an experiment commit wholesale merely to move one production fix.

### Hotfix

Start urgent fixes from `hotfix/urgent-fixes` or a new branch based on the latest `origin/main`. Use a separate clean worktree when the development checkout contains unfinished changes. Before commit and deployment, verify that the diff excludes migrations 024/025, `chatbot_ai_*`, RAG probes, and unrelated `whatsapp.service.js` or `ChatbotAI.jsx` changes unless the hotfix explicitly targets them.

After a hotfix is accepted into `main`, merge or cherry-pick the same reviewed hotfix commit back into the release and development branches so it is not lost.

## Required verification

Before proposing `release/rag-merge-ready` for merge:

```powershell
Set-Location "D:\Self Project\WA-Bot\backend"
npm test

Set-Location "D:\Self Project\WA-Bot\frontend"
npm run build
```

Also verify focused RAG tests, Express/OpenAPI parity, documentation audit, `git diff --check`, and ignored/sensitive-file coverage. Review the exact range rather than using `git add .`:

```powershell
git diff --name-status origin/main..release/rag-merge-ready
git diff --name-status release/rag-merge-ready..develop/rag-experiments
git diff --name-status origin/main..hotfix/urgent-fixes
```

Expected separation at creation:

- release versus `origin/main`: implementation and automated tests only;
- development versus release: probe scripts, development npm commands, and development reporting only;
- hotfix versus `origin/main`: empty until a specific urgent fix is started.
