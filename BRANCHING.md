# WA-Bot Branch Strategy

Updated: 2026-09-14

## Branch responsibilities

| Branch | Purpose | Allowed content | Base/key commit |
|---|---|---|---|
| `main` | Current shared baseline | Only changes that passed the agreed merge and release gates | `63c93c6` at separation time |
| `release/rag-merge-ready` | RAG implementation candidate for review and merge into `main` | Runtime code, migrations, configuration examples, UI changes, and automated tests that passed local validation | Core evaluator/tests through RAG-0910; excludes paid provider runner and development-only npm command |
| `develop/rag-experiments` | Ongoing RAG development and paid/offline experiments | Everything from the release candidate plus provider probes, free-form test runners, development-only commands, and experiment notes | RAG-0901–RAG-0910 plus paid phase-9 runner; use the reviewed branch-tip SHA |
| `hotfix/urgent-fixes` | Urgent production/staging bug fixes | The smallest isolated fix and its focused regression test; no unfinished RAG or experiment files | Directly from `origin/main` at `63c93c6` |

The three branches were published to `origin` on 2026-09-11 after explicit approval. Publishing the refs did not merge or deploy them, and `origin/main` remained at `63c93c6`. Branch names are not deployment evidence; deploy and rollback must always use a reviewed explicit commit SHA.

Current local milestone on 2026-09-15: RAG-0901–RAG-0915 are complete, so Fase 9 is 15/15 and the overall checklist is 118/131 DONE, 1 partial, 12 TODO. The final 25-request run recorded 10/10 social persona replies without false CS, 10/10 contextual gold-source hits, and 5/5 weak false positives avoided by threshold 0.7571067. Full backend 395/395 passed across 78 suites, frontend lint/build/API guard and QA passed, npm audit reports 0 vulnerabilities, and route/OpenAPI parity remains 123/123. These are LOCAL/GIT candidate facts only; the prior grounded score 32/35 remains below target, and real embedding all-in cost, billing reconciliation, runtime migration, WhatsApp delivery, staging deploy, UAT, and merge to `main` have not occurred.

## Separation rules

RAG-0906–RAG-0910 add reusable answer-quality/token/cost/latency evaluation and log-sensitivity audit. Provider calls exist only in the development runner; the release candidate receives the evaluator, shared deterministic fixture, and automated tests. No schema migration or runtime activation was added.

### Release candidate

`release/rag-merge-ready` must not contain:

- `backend/scripts/probe_chatbot_ai_provider.js`;
- `backend/scripts/probe_chatbot_ai_rag_development.js`;
- `backend/scripts/probe_chatbot_ai_rag_phase9.js`;
- npm scripts `test:ai-provider`, `test:rag-development`, `test:rag-freeform-development`, or `test:rag-phase9`;
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
