# dsh-codex-advisor

A persistent **Codex advisor** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

One DSH session can keep several labeled Codex threads. Continue a thread for the same objective, or start another for a different aspect or model class. Codex runs through the official `codex app-server` protocol under your existing ChatGPT/Codex login, so it uses your Codex quota rather than a separate API key.

> **Current release: 0.9.4.** Tested with DSH Desktop `0.2.1-rc.5` on Windows 11 and Codex CLI `0.166.0-alpha.5.1`. See [Compatibility](#compatibility).

## What you get

- Six native tools: `codex_ask`, `codex_poll`, `codex_cancel`, `codex_status`, `codex_history`, `codex_reset`.
- A **Codex trail** tab with thread rail, Markdown Ask/Answer blocks, activity, and a per-turn `model · effort` footnote.
- A compact **Codex Advisor** card in the sidebar with the active thread, latest ask/answer, status light, and model/effort. The card takes its own row in the sidebar footer (the host renders `sidebar.footer.action` as one non-wrapping flex row, so the card lets that row wrap while it is mounted). Its mark is filled and lightly stroked: this asset is a thin ribbon outline, and stroke-only rendering at sidebar size antialiases into a grey smudge.
- **Left/right dock switcher**: the card's own brand mark is the switch — it shows the ChatGPT glyph at rest and the panel glyph while the card is hovered or focused, so the header gains no extra control and the trailing status/model cluster keeps its space. Clicking it moves the card between the sidebar and a measured right-hand dock. The right seat lives in `shell.overlay` and measures the conversation column; it caps the dock at 480px and falls back to a 240px compact dock when the strip is narrower than 200px; docked right the card keeps the sidebar fill. Two plugin docks on the same side stack by a fixed contract (see below), never by chasing each other. The choice is stored in `localStorage` under `dsh-codex-advisor:position`.
- **Split-pane aware**: the sidebar card follows the focused pane; a pane-owned view keeps its own `sessionId`, and shared split containers/toolbars do not steal focus. Focus switching only reads snapshots — it never calls `codex_ask` or writes thread/state. Tested against the latest `dsh-multiview` (`0.1.20`); older split-view versions are not supported.
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
https://github.com/Awenforever/dsh-codex-advisor/archive/refs/tags/v0.9.4.tar.gz
```

After installation, add/keep the `codex-advisor` bundle and restart DSH if the Host requests it. A client-bundle change may require a full DSH quit/reopen or a page reload; the Codex tab and sidebar card appear after the client bundle is reloaded.

### Web / CLI profile

```powershell
dsh plugin --profile <profile> add https://github.com/Awenforever/dsh-codex-advisor/archive/refs/tags/v0.9.4.tar.gz
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

Routing is deterministic: the caller chooses a `purpose`, and the plugin maps it to a model family and effort. It does not infer the purpose from message text or length. A thread's model is pinned at creation; effort can change per turn.

| Purpose | Model family | Effort | When to use |
|---|---|---|---|
| `architecture` | astra | max | Hard architecture, irreversible tradeoffs |
| `plan` | astra | high | Implementation strategy and sequencing |
| `review` | sol | max | Independent correctness/security/design review |
| `accept` | astra | high | Final acceptance of completed work |
| `implement` | sol | medium | Multi-file implementation with integration risk |
| `debug` | sol | medium | Root-cause investigation of a failing system |
| `explore` | terra | high | Open-ended reconnaissance/options; no production writes |
| `general` | terra | medium | Default fallback when no narrower intent fits |
| `verify` | luna | max | Bounded tests, CI, reproduction; Luna is floored at max |
| `routine` | luna | max | Mechanical, high-certainty, low-blast-radius work; Luna is floored at max |

The policy stores a **family**, not a frozen version. On new-thread creation the plugin reads `model/list` from the Codex app-server and selects the newest visible version in that family; if a future `gpt-6.1-luna` appears, `routine`/`verify` use it automatically. Static names are fallbacks when the catalog is unavailable. An exact model id pins that exact version; a family alias (for example `luna`) resolves to its newest visible version.

### Right-dock stacking contract

Two docks that each "yield to whatever is above me" chase each other downwards forever. The contract that terminates this is **first come, first served**:

- the moment a dock becomes active on the right it claims an arrival number from `window.__dshRightDockArrival` and publishes it as `data-codex-advisor-dock-order` (this plugin) / `data-ustc-quota-dock-order` (`dsh-ustc-quota`);
- a dock yields only to a neighbour with a **smaller** arrival number, i.e. one that got there first; a neighbour that arrived later stacks below instead;
- a dock that was already on the right when the neighbour appeared never yields to a neighbour sitting below it;
- positions are computed from the *natural* top, before any yielding;
- neighbours that publish no arrival number fall back to a position rule (yield when the neighbour already occupies this slot, and on an exact tie the earlier id yields) so the first paint cannot deadlock. Two overlapping cards are worse than a wrong order.

Deliberately not id-ordered and not height-ordered: whoever arrived first keeps the slot. The same rule is implemented by `dsh-ustc-quota` v1.1.58; do not "simplify" it back into an unconditional stack-below, which reintroduces the spiral.

## Configuration

All fields are optional. Set them in the `codex-advisor` bundle config.

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | |
| `codexCommand` | `""` | Absolute Codex executable. Empty auto-discovers `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`, then `PATH`, then `@openai/codex`. Set this explicitly on non-Windows systems. |
| `codexArgv` | `null` | Full argv override for wrappers/tests. |
| `codexArgs` | `[]` | Extra args after `app-server --stdio`. |
| `model` | `""` | Fallback model for new threads; a family alias resolves to the latest visible version. |
| `reasoningEffort` | `""` | Fallback effort for new/continued turns. |
| `modelCatalogTtlMs` | `300000` | Cache for `model/list`; refreshed on new-thread routing. |
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
- **Split-pane focus is tested against the latest `dsh-multiview` only** (`0.1.20` at this release, on DSH `0.2.2-rc.1`). This plugin does not carry per-version shims for older split-view plugins: if a split-view release changes its focus semantics, the supported target moves to that newer release rather than adding backward compatibility. If you use an older `dsh-multiview`, focus following is unsupported and may stick to the last-mounted pane.
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
