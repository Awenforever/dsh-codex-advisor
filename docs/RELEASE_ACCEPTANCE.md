# Release acceptance — dsh-codex-advisor 0.1.0

Status: **development / not yet accepted for production** (see G0 note).

## Environment

| Item | Value |
|---|---|
| DSH | 0.2.1-rc.5, desktop profile (production host `desktop-kfscv8c-1`) |
| Codex | `codex-cli 0.166.0-alpha.5.1` |
| Node (tests) | v24.13.0 |
| OS | Windows 11 10.0.26300 |
| Isolated profile | `%DSH_HOME%\profiles\advisor-test` (headless template) |
| Test state dir | `.scratch\advisor-test-state` (outside production state) |

## L0 — real Codex protocol (invictus)

| Check | Result | Evidence |
|---|---|---|
| `thread/start {ephemeral:false}` | PASS | thread `01a19d45-8029-7260-b454-d04800977709`, `ephemeral:false` |
| cross-process `thread/resume` | PASS | new app-server returned the same id; `turnCount=3` |
| history retained in resumed thread | PASS | token `AMBER-WALRUS-2290` + fixture path found in resumed turns |
| missing thread error | PASS | `-32600 no rollout found for thread id …` |
| second writer error | PASS | `-32600 thread … already has an active writer` |
| `thread/read` while another writer holds it | PASS | turnCount=3 |
| real turn recall / file read / interrupt / approvals | **BLOCKED** | account weekly quota 100%, reset 2026-11-04 14:36 +0800; `usageLimitExceeded` |

Artifacts: `spike/runs/2026-11-02T17-18-59-576Z/`, `…-history/`, `…-writer/`; report `reports/2026-11-03-M0-codex-resume.md`.

## L1 — offline contract tests

Command:

```powershell
node --test --test-force-exit test/jsonrpc.test.mjs test/store.test.mjs test/codex.test.mjs test/manager.test.mjs test/manifest.test.mjs
```

Result: **25 pass / 0 fail** (2026-11-03). Coverage: JSON-RPC framing/correlation/timeout/abort, state atomicity/digest/eviction, thread start+resume across fake-app-server restarts, missing thread, writer conflict, interrupt, auto-declined approvals, activity files/commands, quota preflight, poll, cancel, reset, manifest/patch/locale checks.

## L2 — Host-level harness

Command:

```powershell
node test/harness/host-level.mjs
```

Result: **PASS**. The plugin's `apply` was invoked with a stub Cordis context; five tools registered; `codex_ask` completed two turns on one fake thread; `codex_status` reported `state=ready`; `codex_reset` produced a new thread; dispose closed the child.

## L3 — real DSH composition and activation (isolated profile)

| Check | Result | Evidence |
|---|---|---|
| profile created from headless template | PASS | `~/.dsh/profiles/advisor-test` |
| bundle installed and auto-added to `dsh.profile.bundles` | PASS | `dsh plugin --profile advisor-test add <path>` |
| composed profile contains `codex-advisor` row | PASS | `dsh --profile advisor-test --dump-config` |
| plugin activates in a real DSH Host | PASS | `.scratch/advisor-test-state/events.ndjson` → `{"event":"activate","pid":36944,…}` |
| model-driven four scenarios | **BLOCKED** | headless boot: `MISSING_CREDENTIAL: llm-deepseek … deepseek-official` (no model credential in the isolated profile) |

## L4 — win11-test

Host `DESKTOP-GB7NLMT` (100.108.63.25), DSH 0.2.1-rc.5, ssh user `king` (elevated), interactive console session `Administrator`.

| Check | Result | Evidence |
|---|---|---|
| bundle staged into the test instance's desktop profile | PASS | `C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-codex-advisor` (13 files); backup `package.json.bak-20261103-codex-advisor` |
| bundle row added | PASS | `dsh.profile.bundles` → base, web-app, dsh-ustc-quota, dsh-codex-advisor |
| installed module imports under Electron-as-Node | PASS | `IMPORT_OK apply,default,inject,name` |
| Windows Host activation (isolated headless profile, same rc.5) | PASS | `C:\Users\king\.dsh\codex-advisor\events.ndjson` → `{"event":"activate","pid":328,…}` |
| L2 harness on Windows | PASS | `L2 PASS {tools:[…5], threadId:thr-…}` via `DeepSeek Harness.exe` as Node |
| restart harness on Windows | PASS | `RESTART PASS {…}` same `thread_id` after dispose + re-apply |
| desktop profile activation in the DSH app | **PENDING** | the app was not running on the VM; next launch must show the `activate` event and the five tools |
| real Codex on the VM | not planned | decision: VM uses the fake app-server; real Codex e2e stays on invictus |

## Four required scenarios

| Scenario | Offline / fake | Real DSH + real Codex |
|---|---|---|
| S1 same thread two rounds | PASS (manager test: same `thread_id`, `history=1`; Windows L2 two asks) | blocked (quota) |
| S2 mid-course change | PASS (same-thread conversation; fake counts history) | blocked (quota) |
| S3 final acceptance | PASS (digest/answer retention; same thread) | blocked (quota) |
| S4 DSH restart / recovery | PASS (manager restart + Windows restart harness; missing thread fails closed with digest) | DSH activation PASS; model-driven blocked |

## G0 note

The structural half of G0 passed; the semantic half (real model turn recalling the previous token, read-only tool use, interrupt, approval) is deferred until the Codex weekly quota resets or another credential decision is made. Production rollout must not proceed before this is completed.

## Rollback (test profile)

```powershell
dsh plugin --profile advisor-test remove dsh-codex-advisor
```

Then remove `.scratch/advisor-test-state` if the evidence has been archived.
