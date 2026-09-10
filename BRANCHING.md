# WA-Bot Branch Strategy

Updated: 2026-09-10

## Branch responsibilities

| Branch | Purpose | Allowed content | Base/key commit |
|---|---|---|---|
| `main` | Current shared baseline | Only changes that passed the agreed merge and release gates | `63c93c6` at separation time |
| `release/rag-merge-ready` | RAG implementation candidate for review and merge into `main` | Runtime code, migrations, configuration examples, UI changes, and automated tests that passed local validation | Core implementation commit `da2867d` |
| `develop/rag-experiments` | Ongoing RAG development and paid/offline experiments | Everything from the release candidate plus provider probes, free-form test runners, development-only commands, and experiment notes | Experiment commit `e758db7` on top of `da2867d` |
| `hotfix/urgent-fixes` | Urgent production/staging bug fixes | The smallest isolated fix and its focused regression test; no unfinished RAG or experiment files | Directly from `origin/main` at `63c93c6` |

The branches are local until an explicit push is approved. Branch names are not deployment evidence; deploy and rollback must always use a reviewed explicit commit SHA.

## Separation rules

### Release candidate

`release/rag-merge-ready` must not contain:

- `backend/scripts/probe_chatbot_ai_provider.js`;
- `backend/scripts/probe_chatbot_ai_rag_development.js`;
- npm scripts `test:ai-provider`, `test:rag-development`, or `test:rag-freeform-development`;
- `apiDevelopment.txt`, `ChatBot-Flow (2).json`, or `PersonaChatBot.txt`;
- raw experiment transcripts, credentials, runtime databases, sessions, uploads, backups, or exports.

The current release candidate passed local backend, frontend, route/OpenAPI, and documentation validation. It is ready for code review and merge consideration, but it is **not yet approved for staging or production deployment**. Migrations 024/025 still require protected-copy preflight, backup/restore evidence, an approved rollout, staging smoke, and UAT as applicable.

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
