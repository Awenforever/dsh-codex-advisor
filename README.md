# dsh-codex-advisor

A persistent **Codex advisor** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) sessions.

One DSH session keeps **one Codex thread**: ask for a plan, change the plan mid-course, and request a final acceptance review without re-sending the conversation. The binding survives DSH restarts. Codex runs through the official `codex app-server` protocol under the user's existing ChatGPT/Codex login, so it uses the user's Codex quota, not a new API key.

## Tools

| Tool | Purpose |
|---|---|
| `codex_ask` | Send one new request to the bound thread. Waits up to `wait_seconds`; if the turn is still running, returns `status=running` with a `turn_id`. |
| `codex_poll` | Collect a running/finished turn. |
| `codex_cancel` | Send `turn/interrupt`. |
| `codex_status` | App-server state/version, bound thread, active turn, quota snapshot, last error. |
| `codex_reset` | Start a new thread (the old thread stays in Codex; it is not deleted). |

The advisor thread is bound to the DSH `SessionId`, so reopening the same DSH session resumes it automatically. A new DSH session can attach an existing thread with `codex_ask({ thread_id })`.

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
| `model` | `""` | `""` uses the Codex config (`gpt-6.1-sol` on the reference machine). |
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
  state.json     # sessionId -> { threadId, generation, cwd, digest, ... }
  events.ndjson  # bounded diagnostics (activate/ask/resume/error/cancel)
```

- `state.json` is replaced atomically (temp file + rename).
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

`CODEX_NOT_FOUND`, `CODEX_SPAWN_FAILED`, `CODEX_INIT_FAILED`, `CODEX_NOT_LOGGED_IN`, `CODEX_QUOTA_EXCEEDED`, `CODEX_MODEL_UNAVAILABLE`, `CODEX_THREAD_NOT_FOUND`, `CODEX_THREAD_BUSY`, `CODEX_RESUME_FAILED`, `CODEX_TIMEOUT`, `CODEX_CANCELLED`, `CODEX_TURN_FAILED`, `CODEX_TURN_START_FAILED`, `CODEX_CONTEXT_EXCEEDED`, `CODEX_EMPTY_ANSWER`, `CODEX_NO_THREAD`, `CODEX_BAD_ARGS`, `CODEX_BAD_CONFIG`, `CODEX_APP_SERVER_EXITED`, `CODEX_INTERNAL`.

Each tool result carries `code`, `message`, and a short `hint`.

## Development

```powershell
node --check index.js
node --test --test-force-exit test/jsonrpc.test.mjs test/store.test.mjs test/codex.test.mjs test/manager.test.mjs test/manifest.test.mjs
node test/harness/host-level.mjs
```

The offline tests use `test/fake-app-server.mjs`, which speaks the subset of the app-server protocol used here and persists threads across process restarts.

## Status and known residuals

Development and verification are complete through the fake-Codex path as of 2026-11-03; **production is not deployed**. Residual IDs match `docs/RELEASE_ACCEPTANCE.md` and the CollabCenter project page.

| ID | State | Detail |
|---|---|---|
| R1 | open | Real Codex semantic turn (recall, tools, interrupt, approvals) is pending the ChatGPT weekly quota reset (2026-11-04 14:36 +0800). |
| R2 | closed | The isolated-profile e2e used a process-scoped USTC key injection (never persisted); S1–S4 passed against the fake app-server. |
| R3 | open (verification gap) | On `win11-test` the bundle is installed and the desktop-profile composition is validated via a copy (`vm-desktop-copy`); launching the DSH app in the Administrator console is pending VMware guest credentials. VMware guest operations reject the blank-password `king` account, and the Administrator credential is not available. |
| R4 | open | Installing into the production `desktop` profile and restarting DSH require explicit operator approval (M5). |

## Compatibility

- DSH: developed against `0.2.1-rc.5` (Host APIs: `tools.register`, `subprocess.spawn`, `systemPrompt.section`, `workingDirectory.ensure`).
- Codex: structurally verified against `codex-cli 0.166.0-alpha.5.1` (`thread/start` non-ephemeral, cross-process `thread/resume`, `turn/interrupt`, writer-lock errors). Real turn semantics were pending the account's weekly quota reset at the time of writing; see `docs/RELEASE_ACCEPTANCE.md`.
- Windows 11: primary target; no Unix socket, no daemon dependency.
