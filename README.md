# dsh-codex-advisor

A persistent **Codex advisor** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

One DSH session can keep several labeled Codex threads. Continue a thread for the same objective, or start another for a different aspect or model class. Codex runs through the official `codex app-server` protocol under your existing ChatGPT/Codex login, so it uses your Codex quota rather than a separate API key.

> **Current release: 0.7.4.** Tested with DSH Desktop `0.2.1-rc.5` on Windows 11 and Codex CLI `0.166.0-alpha.5.1`. See [Compatibility](#compatibility).

## What you get

- Six native tools: `codex_ask`, `codex_poll`, `codex_cancel`, `codex_status`, `codex_history`, `codex_reset`.
- A **Codex trail** tab with thread rail, Markdown Ask/Answer blocks, activity, and a per-turn `model · effort` footnote.
- A compact **Codex advisor** card in the sidebar with the active thread, latest ask/answer, status light, and model/effort.
- **Split-pane aware**: the sidebar card follows the focused pane; a pane-owned view keeps its own `sessionId`, and shared split containers/toolbars do not steal focus.
- **Theme-aware UI**: surfaces, Ask/Answer tints, status colors, errors, and the update modal use DSH semantic tokens and follow DSH light/dark automatically. There is no separate theme toggle.
- State and thread bindings survive DSH restarts.
- Explicit source/model/effort provenance on every tool result.

## Requirements

- **DSH Desktop** `0.2.1-rc.5` or newer in the `0.2.x` line. The plugin is currently developed and tested on Windows 11.
- **Codex CLI** with `app-server --stdio` support and a logged-in ChatGPT/Codex account. The CLI is not bundled with this plugin.
- Available Codex quota for real turns. A quota error is returned as a tool error with the reset time when the service provides one.
- Node.js `>=22` (the DSH desktop runtime already provides it).

The plugin is not affiliated with OpenAI or DeepSeek. It uses your existing Codex login and quota.

## Install

### DSH Desktop

Install the release tarball through DSH's plugin manager:

```text
https://github.com/Awenforever/dsh-codex-advisor/archive/refs/tags/v0.7.4.tar.gz
```

After installation, add/keep the `codex-advisor` bundle and restart DSH if the Host requests it. A client-bundle change may require a full DSH quit/reopen or a page reload; the Codex tab and sidebar card appear after the client bundle is reloaded.

### Web / CLI profile

```powershell
dsh plugin --profile <profile> add https://github.com/Awenforever/dsh-codex-advisor/archive/refs/tags/v0.7.4.tar.gz
```

Then restart that DSH profile. For the app-managed `desktop` profile, use the app's plugin manager instead of editing the profile by hand.

## Updates

The version badge checks the latest non-prerelease GitHub release. On DSH builds that expose an official `pluginUpdates` service, the modal can install automatically.

**Current DSH 0.2.1-rc.5 does not expose that service.** The official `pluginManager` can install a bundle but does not provide an in-place upgrade API, so this release deliberately presents a **manual update path**:

1. Click the version badge to check for a newer release.
2. Use **Open release** for notes.
3. Install the new release tarball through DSH's plugin manager.
4. Quit and reopen DSH, or reload the client bundle, so the UI and Host versions match.

There is no fake one-click install button when the host cannot support it.

## Tools

| Tool | Purpose |
|---|---|
| `codex_ask` | Send a request to the active, labeled, or new thread (`thread`, `thread_id`, `new_thread`, `label`, `model`, `effort`, `purpose`). |
| `codex_poll` | Collect a running or finished turn. |
| `codex_cancel` | Interrupt the current turn. |
| `codex_status` | App-server connection, threads, active thread, quota, and last error. |
| `codex_history` | Read a thread's turns, answers, commands, files, and provenance. |
| `codex_reset` | Start a new labeled thread without deleting old threads. |

The DSH agent chooses the model/effort from difficulty, ambiguity, and stakes, not from message length. A thread's model is pinned at creation; effort can change per turn.

## Configuration

All fields are optional. Set them in the `codex-advisor` bundle config.

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | |
| `codexCommand` | `""` | Absolute Codex executable. Empty auto-discovers `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`, then `PATH`, then `@openai/codex`. Set this explicitly on non-Windows systems. |
| `codexArgv` | `null` | Full argv override for wrappers/tests. |
| `codexArgs` | `[]` | Extra args after `app-server --stdio`. |
| `model` | `""` | Fallback model for new threads. |
| `reasoningEffort` | `""` | Fallback effort for new/continued turns. |
| `sandbox` | `workspace-write` | `read-only` for advice-only use. |
| `approvalPolicy` | `never` | Interactive approvals are auto-declined. |
| `defaultWaitSeconds` / `maxWaitSeconds` | `180` / `1800` | `codex_ask` wait behavior. |
| `idleRecycleMs` | `600000` | Close an idle app-server process; `0` disables. |
| `maxThreads` | `100` | Bound-session eviction limit. |
| `digestBytes` | `4096` | Recovery digest budget. |
| `stateDir` | `""` | `""` uses `$DSH_HOME/codex-advisor`. |
| `quotaCheckTtlMs` | `60000` | Rate-limit cache. |
| `env` | `{}` | Extra child environment. |

## Security and privacy

- Codex runs as a stdio child process; this plugin opens no listening port.
- Credentials remain in your Codex profile (`~/.codex`); the plugin does not read or copy `auth.json`.
- The default sandbox is `workspace-write`, which allows the advisor to modify the session working directory. Use `sandbox: read-only` for advice-only use, and review `activity.files` / `activity.commands`.
- Interactive approvals are declined automatically; declined requests are counted in `activity.declined`.
- State is stored under `$DSH_HOME/codex-advisor/{state.json,events.ndjson}`. It may contain recent prompt/answer digests for recovery; set `digestBytes: 0` to disable digests. Uninstalling does not delete the state directory.
- Network access: GitHub API for release checks, and whatever the Codex CLI itself uses for your account. No telemetry is sent by this plugin.

## Compatibility and limitations

- **Windows 11 / DSH Desktop `0.2.1-rc.5`** is the primary tested target. The Codex auto-discovery path is Windows-specific; other systems must set `codexCommand`.
- Codex `app-server` is an experimental interface. A thread has one writer; if Codex Desktop holds the thread, the bridge reports `CODEX_THREAD_BUSY`.
- Quota and account model availability are controlled by Codex, not this plugin.
- Markdown rendering covers headings, lists, code fences, inline code, emphasis, links, blockquotes, and rules. Tables, images, and raw HTML are not rendered as HTML.
- Historical turns created before per-turn provenance existed may not show an effort footnote.
- Client bundle updates can require a DSH page reload or a full quit/reopen.

## Development

```powershell
node --check index.js
node --check client.js
node --test --test-force-exit test/jsonrpc.test.mjs test/store.test.mjs test/codex.test.mjs test/manager.test.mjs test/manifest.test.mjs test/update.test.mjs test/client.test.mjs
node test/harness/host-level.mjs
node test/harness/failure-level.mjs
npm pack --dry-run
```

Tests use a fake app-server and do not require a Codex login or quota.

## License

MIT. See [LICENSE](LICENSE).
