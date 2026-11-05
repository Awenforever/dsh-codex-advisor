# dsh-codex-advisor

[![CI](https://github.com/Awenforever/dsh-codex-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/Awenforever/dsh-codex-advisor/actions/workflows/ci.yml)

A persistent **Codex advisor** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) sessions.

One DSH session can keep **several labeled Codex threads**. Continue a thread for the same objective; start a new one for a genuinely different aspect or a different model class. Codex runs through the official `codex app-server` protocol under the user's existing ChatGPT/Codex login, so it uses the user's Codex quota, not a new API key.

Each thread pins its model at creation. Effort can change on every ask. The DSH agent chooses model and effort from task difficulty, ambiguity, and stakes — not from message length. The advisor answers in English.

## Tools

| Tool | Purpose |
|---|---|
| `codex_ask` | Send one new request to the active thread, a labeled thread, or a new thread (`new_thread`/`label`/`model`/`effort`/`purpose`). Waits up to `wait_seconds`; if the turn is still running, returns `status=running` with a `turn_id`. |
| `codex_poll` | Collect a running/finished turn. |
| `codex_cancel` | Send `turn/interrupt`. |
| `codex_status` | App-server state, labeled threads, active thread, quota, last error. |
| `codex_history` | Read any labeled thread's last N turns with per-turn model/effort and activity. |
| `codex_reset` | Start a new labeled thread (old threads stay in Codex; they are not deleted). |

The active thread is bound to the DSH `SessionId`, so reopening the same DSH session resumes it automatically. `codex_ask({ thread: "label" })` continues another thread without losing the active one; `codex_history({ thread: "label" })` reads it without switching.

## Provenance

Every `codex_*` result, including a failed result, carries a `source` object:

```json
{"kind":"codex-advisor","transport":"codex-app-server","plugin":"dsh-codex-advisor","version":"0.3.0","model":"gpt-6-luna","effort":"max"}
```

`codex_history` returns the Codex side's own turns (ask, final answer, commands, files), so provenance is inspectable rather than only a chat paraphrase. The plugin's system-prompt section requires the DSH agent to label Codex output explicitly and include the thread/turn.

The bridge does **not** expose Codex's internal reasoning; it exposes protocol-level facts (threads, turns, answers, command/file items, approvals, quota).

For the design evaluation (tab vs sidebar), see [docs/L2_UI_PLAN.md](docs/L2_UI_PLAN.md).

## UI (0.6.x)

The bundle ships a client half. All visible copy is English.

- **Codex trail**: registered in `conversation.view` (id `codex-advisor`, order 20). A labeled thread selector, readable ask/answer blocks, collapsible activity, and a per-turn `model · effort` footnote. The selected thread is read without changing the active advisor thread.
- **Sidebar card**: registered in `sidebar.footer.action` (id `codex-advisor-card`). It is a mini status screen, not a duplicate of the trail: status and turn count, active thread label and thread count, latest ask, latest answer or failure, latest command/file activity, and the current model/effort at the bottom. No raw thread ids.
- **Session probe**: registered in `conversation.composer.dock` so the card follows the active DSH session.
- **Version/update**: the tiny (8.5px) version button follows the USTC quota panel behavior: click to force a check, a 5px red dot when a newer release exists, inline checking/up-to-date/failure notice, auto-check 1.2s after load and every 24h, and an update modal with release notes, provider, copy-spec fallback, and install. The Host uses the latest non-prerelease GitHub release, caches it for six hours, and delegates installation to the official `pluginManager`/`pluginUpdates` seam. A client bundle change still requires a full DSH quit/reopen.
- Client requests are bounded (15s snapshot/update, 60s history).

The Host exposes same-origin routes used by the client:

```text
GET  /plugins/dsh-codex-advisor/snapshot?session_id=…             # no app-server spawn
GET  /plugins/dsh-codex-advisor/history?session_id=…&thread=…&limit=20
GET  /plugins/dsh-codex-advisor/update                             # latest release, cached
POST /plugins/dsh-codex-advisor/update/apply                       # { spec } via provider
```

The routes are gated by the DSH connection fence on the Web host and skipped on the Desktop host. The client half is loaded at DSH start; after installing or updating a client bundle, fully quit and reopen DSH.

## Install

```powershell
dsh plugin --profile <profile> add <path-or-package>
```

`dsh plugin add` adds the package dependency and the bundle to `dsh.profile.bundles`; restart DSH after installation. For the app-managed `desktop` profile, install through the app's plugin manager / `plugin_manager` tool instead of editing the profile by hand.

The bundle contains a single Host row (`codex-advisor`) and declares no runtime dependencies: the bridge uses Node built-ins and the DSH Host services (`tools`, `subprocess`, `systemPrompt`, `workingDirectory`).

## Configuration

The row accepts these fields (all optional):

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | |
| `codexCommand` | `""` | Absolute executable; `""` auto-discovers `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`, then `PATH`, then the `@openai/codex` package. |
| `codexArgv` | `null` | Full argv override (tests/wrappers). Takes precedence over `codexCommand`. |
| `codexArgs` | `[]` | Extra args after `app-server --stdio`. |
| `model` | `""` | Fallback model when a new thread has neither `model` nor `purpose`; `""` uses the Codex config. A thread keeps this model for its lifetime. |
| `reasoningEffort` | `""` | Fallback effort for a new/continued turn; the DSH agent can override per ask. |
| `sandbox` | `workspace-write` | `read-only` or `workspace-write`. |
| `approvalPolicy` | `never` | Approval requests are auto-declined; the turn continues with the refusal. |
| `defaultWaitSeconds` | `180` | `codex_ask` wait default. |
| `maxWaitSeconds` | `1800` | `codex_ask` wait cap. |
| `idleRecycleMs` | `600000` | Close the app-server after idleness (releases the thread writer lock). `0` disables. |
| `maxThreads` | `100` | Bound-session eviction limit (Codex threads are not deleted). |
| `digestBytes` | `4096` | Brief budget used only when a thread cannot be resumed. |
| `stateDir` | `""` | `""` = `$DSH_HOME/codex-advisor`. |
| `quotaCheckTtlMs` | `60000` | Rate-limit preflight cache. |
| `env` | `{}` | Extra child environment (the base set is PATH/USERPROFILE/CODEX_HOME/proxy variables). |

## State and recovery

```
$DSH_HOME/codex-advisor/
  state.json     # sessionId -> { activeThreadId, threads: { id -> label/model/digest/turnMeta/... } }
  events.ndjson  # bounded diagnostics (activate/ask/resume/error/cancel)
```

- `state.json` is replaced atomically (temp file + rename). Version 1 state from 0.5.x migrates automatically.
- A session keeps the active thread at the top level and every alternate thread in `threads`; each has its own digest and per-turn model/effort metadata.
- On the first ask after a DSH restart, the bridge sends `thread/resume {threadId}`.
- If Codex reports `no rollout found`, the bridge **fails closed**: starts a new thread, prepends a compact digest (recent asks + last answer) and returns `recovered: "new-thread"`.
- `active writer` (Codex Desktop holds the thread) maps to `CODEX_THREAD_BUSY`; there is no force-takeover in the app-server protocol.
- The digest is never written to Codex or DSH logs; it stays in the state file and can be disabled with `digestBytes: 0`.

## Security

- No listening port; the app-server is a stdio child process.
- Codex credentials stay in `~/.codex`; the plugin never reads `auth.json` contents and never copies credentials.
- Default `sandbox: workspace-write` (the user's choice) lets the advisor modify the session working directory. The tool result includes `activity.files` and `activity.commands`; review them before accepting the work. Set `sandbox: read-only` for advice-only use.
- Interactive approvals (commands, file changes, extra permissions, MCP elicitation) are declined automatically; a declined request is counted in `activity.declined`.
- The child environment is reduced to the variables Codex needs (PATH, user/profile paths, `CODEX_HOME`, proxy variables) plus explicit `env` overrides.

## Error codes

`CODEX_NOT_FOUND`, `CODEX_SPAWN_FAILED`, `CODEX_INIT_FAILED`, `CODEX_NOT_LOGGED_IN`, `CODEX_QUOTA_EXCEEDED`, `CODEX_MODEL_UNAVAILABLE`, `CODEX_THREAD_NOT_FOUND`, `CODEX_THREAD_BUSY`, `CODEX_THREAD_MODEL_PINNED`, `CODEX_RESUME_FAILED`, `CODEX_TIMEOUT`, `CODEX_CANCELLED`, `CODEX_TURN_FAILED`, `CODEX_TURN_START_FAILED`, `CODEX_CONTEXT_EXCEEDED`, `CODEX_EMPTY_ANSWER`, `CODEX_NO_THREAD`, `CODEX_BAD_ARGS`, `CODEX_BAD_CONFIG`, `CODEX_APP_SERVER_EXITED`, `CODEX_INTERNAL`.

Each tool result carries `code`, `message`, and a short `hint`.

## Development

```powershell
node --check index.js
node --test --test-force-exit test/jsonrpc.test.mjs test/store.test.mjs test/codex.test.mjs test/manager.test.mjs test/manifest.test.mjs test/update.test.mjs test/client.test.mjs
node test/harness/host-level.mjs
node test/harness/failure-level.mjs
```

The offline tests use `test/fake-app-server.mjs`, which speaks the subset of the app-server protocol used here and persists threads across process restarts. `failure-level.mjs` runs the fake server in `turn-fail` mode and asserts that the failed result, `poll.last_failure`, `snapshot.last_failure`, and `history.turns[].error` all expose the failure.

## Status and known residuals

Development and verification are complete, including the real Codex R1 acceptance; the production bundle is installed and accepted with `gpt-6-luna` + `max`. Residual IDs match `docs/RELEASE_ACCEPTANCE.md` and the CollabCenter project page.

| ID | State | Detail |
|---|---|---|
| R1 | closed (2026-11-04) | Real Codex: app-server resume, recall `AMBER-WALRUS-5078`, read-only command, write `R1-WRITE-OK`, `turn/interrupt`, approval declined; production two turns on one thread; no quota error. See [R1 report](reports/2026-11-04-R1-real-codex.md). |
| R2 | closed | The isolated-profile e2e used a process-scoped USTC key injection (never persisted); S1–S4 passed against the fake app-server. |
| R3 | closed | `win11-test`: bundle installed; desktop composition and real app launch verified. The app runs as `Administrator` in `SessionId=1` via an interactive scheduled task (`New-ScheduledTaskPrincipal -LogonType Interactive`), plugin `activate` pid 5800, CDP `http://127.0.0.1:9222/json` HTTP 200. |
| R4 | closed (2026-11-05) | Production `desktop` installed `dsh-codex-advisor` **0.5.1** cleanly from tag `v0.5.1` via `plugin_manager`; profile dependency updated; GitHub release `v0.5.1` published; 6 tools; client tab/card/probe live after the 09:43 full restart; 29/29 tests + Windows CI green. Final config: `gpt-6-luna` + `max`; R1 passed. Backups and rollback script are in place. |
| R7 | open (restart) | `v0.5.3` is installed (0.5.2 visual + completion persistence); the current renderer is 0.5.1 until the next full DSH restart. |

`v0.5.3` closes the completion-after-ask-timeout gap: the background completion handler now persists the answer (and failures), `recordTurn` is idempotent, and a manager regression test covers it. A real production turn completed with `CODEX-LIVE-OK` on 2026-11-05 11:15 +0800; the earlier `curl` 000 was a false negative. One restart remains to load the 0.5.3 renderer and the 0.5.2 visual polish.

`v0.5.2` is installed as of 2026-11-05 10:52 +0800; the current DSH renderer remains 0.5.1 until the next full restart, when the clearer no-session card and simpler Codex panel header/source line take effect. The live `/update` route may still show the old 0.5.1 closure until that restart.

During acceptance the production profile used `reasoningEffort: low` (cheaper); after R1 passed it was switched to `max`. `reasoningEffort` is passed to the Codex `turn/start` request.

Windows desktop verification uses a scheduled task with `-LogonType Interactive` plus CDP on port 9222; see `docs/RELEASE_ACCEPTANCE.md` L4.

## Compatibility

- DSH: developed against `0.2.1-rc.5` (Host APIs: `tools.register`, `subprocess.spawn`, `systemPrompt.section`, `workingDirectory.ensure`).
- Codex: structurally verified against `codex-cli 0.166.0-alpha.5.1` (`thread/start` non-ephemeral, cross-process `thread/resume`, `turn/interrupt`, writer-lock errors). Real turn semantics were pending the account's weekly quota reset at the time of writing; see `docs/RELEASE_ACCEPTANCE.md`.
- Windows 11: primary target; no Unix socket, no daemon dependency.
