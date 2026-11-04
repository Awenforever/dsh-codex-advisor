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

## L3 — real DSH composition, activation and model-driven runs (isolated profile)

| Check | Result | Evidence |
|---|---|---|
| profile created from headless template | PASS | `~/.dsh/profiles/advisor-test` |
| bundle installed and auto-added to `dsh.profile.bundles` | PASS | `dsh plugin --profile advisor-test add <path>` |
| composed profile contains `codex-advisor` row | PASS | `dsh --profile advisor-test --dump-config` |
| plugin activates in a real DSH Host | PASS | `.scratch/advisor-test-state*/events.ndjson` → `{"event":"activate",…}` |
| model credential | PASS | `USTC1_API_KEY` injected into the headless process environment only (never written to disk, profile or logs) |
| S1–S3 model-driven, fake Codex | PASS | 3 `codex_ask` calls in one session: same thread `thr-950c779e-1950-4a32-a36f-465e46048042`, history `0 → 1 → 2`, three distinct turn ids; session transcript ends with `turn/end completed` |
| S4 restart, same DSH session | PASS | `headless --session-id session-3cbef3cc-cc72-4c65-acfc-d4e9a1e6dccc` in a new Host process: same thread `thr-1076471a-d28e-4331-8d50-31ee0d4bf5ab`, `history=1` |
| fail-closed recovery | PASS (fixture incident) | when the fake fixture state lost a bound thread, the bridge started a new thread, prepended the digest, returned `recovered:"new-thread"` and the notice; no crash |
| headless exit | PASS | `idle-recycle` + `client:exited` after the turn (the app-server child no longer keeps the Host alive) |

The S4 thread id differs from S1–S3 because a manual test-fixture edit (a BOM-prefixed JSON rewrite) made the fake app-server start with an empty state; the bridge's fail-closed recovery path handled it as designed. A clean retry on the recovered thread then resumed the same thread across a new Host process.

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
| desktop profile composition (copy `vm-desktop-copy`) | PASS | `--dump-config` contains the `codex-advisor` row; booting the copy activated the plugin (`activate` pid 8300) before the app rejected the `headless` arguments (the copied profile uses the desktop app) |
| actual DSH app launch in the Administrator console | PASS (2026-11-03 12:09 +0800) | interactive scheduled task as `Administrator` (`New-ScheduledTaskPrincipal -LogonType Interactive`), process `SessionId=1`, plugin `activate` pid 5800, CDP `http://127.0.0.1:9222/json` HTTP 200, page `dsh-app://app/` |
| real Codex on the VM | not planned | decision: VM uses the fake app-server; real Codex e2e stays on invictus |

## L5 — production desktop (desktop-kfscv8c-1, 2026-11-04)

Host `DESKTOP-KFSCV8C`, user `king_`, DSH `0.2.1-rc.5`, profile `desktop`.

| Check | Result | Evidence |
|---|---|---|
| pre-install backup | PASS | `package.json`, `cordis.patch.yml`, `pnpm-lock.yaml` → `.bak-20261104-codex-advisor`; rollback script `C:\Users\king_\.dsh\codex-advisor-rollback.ps1` |
| install via `plugin_manager` | PASS | initial 0.1.0, upgraded to **0.2.0** (tag `v0.2.0` tarball); `application=applied`; bundle `dsh-codex-advisor` 0.2.0 `enabled/installed` |
| tools registered | PASS | Host `Tool.listTools` includes `codex_ask`, `codex_poll`, `codex_cancel`, `codex_status`, `codex_reset` |
| model/effort config | PASS | acceptance `model: gpt-6-luna`, `reasoningEffort: low`; after R1 switched to `reasoningEffort: max` (activate `2026-11-04T07:12:50.369Z`) |
| activation | PASS | `events.ndjson` → `{"event":"activate","pid":9428,...,"t":"2026-11-04T04:03:04.084Z"}`, reloaded `05:14:06.755Z` and `07:12:50.369Z` |
| restart | not needed | package applied live; the running DSH app remained up |
| real Codex semantic (R1) | **PASS** (2026-11-04 14:42–15:13 +0800) | `gpt-6-luna` + `low`: spike thread `01a1a54b-aeb4-7502-83d2-cf4c0b9b2488` (read-only tool, app-server resume, recall `AMBER-WALRUS-5078`, interrupt); approval thread `01a1a556-19b5-7d60-ad90-ffae77fda0fd` (`declinedApprovals=1`, command declined); production thread `01a1a54c-e261-7123-979e-3544042de507` two turns; write file `.scratch/advisor-r1-write.txt` = `R1-WRITE-OK`; details in [R1 report](../reports/2026-11-04-R1-real-codex.md) |
| max switch | PASS | profile patch `reasoningEffort: max`; plugin reload; `codex_status` → `config.model=gpt-6-luna`, `config.reasoningEffort=max` |
| rollback | ready | `plugin_manager remove_bundle` target `dsh-codex-advisor`, or the rollback script |

## Four required scenarios

| Scenario | Offline / Windows / model-driven (fake Codex) | Real DSH + real Codex |
|---|---|---|
| S1 same thread two rounds | PASS (manager test; Windows L2; real DSH model: same `thread_id`, history `0 → 1 → 2`) | PASS (production thread `01a1a54c…`: two turns, same thread, no errors) |
| S2 mid-course change | PASS (same-thread conversation; fake history increments; model observed prior turns) | PASS (same-thread follow-up in production; spike turn 2 recall) |
| S3 final acceptance | PASS (model used the accumulated thread across three calls) | PASS (spike recalled `AMBER-WALRUS-5078`; production turn 2 answered call 2) |
| S4 DSH restart / recovery | PASS (model-driven `--session-id` resume in a new Host: same thread, `history=1`; Windows restart harness; fail-closed digest on thread loss) | PASS (real app-server restart/resume; plugin restart harness; production app not restarted) |

## Known residuals (R1–R4)

| ID | State | Detail |
|---|---|---|
| R1 | closed (2026-11-04 15:13 +0800) | Real Codex: app-server resume, recall `AMBER-WALRUS-5078`, read-only command, write `R1-WRITE-OK`, `turn/interrupt`, approval declined; production two turns on one thread; no quota error. Details in [R1 report](../reports/2026-11-04-R1-real-codex.md). |
| R2 | closed | Isolated-profile model-driven e2e ran with `USTC1_API_KEY` injected into the headless process environment only (never written to disk/profile/logs); S1–S4 passed against the fake app-server. |
| R3 | closed (2026-11-03 12:09 +0800) | `win11-test`: bundle installed; desktop composition and real app launch verified. The app runs as `Administrator` in `SessionId=1` via an interactive scheduled task (`New-ScheduledTaskPrincipal -LogonType Interactive`), plugin `activate` pid 5800, CDP `http://127.0.0.1:9222/json` HTTP 200, page `dsh-app://app/`. The VMware blank-password boundary is irrelevant to this path. |
| R4 | closed (2026-11-04 15:13 +0800) | Production `desktop` installed `dsh-codex-advisor` **0.2.0** via `plugin_manager` (tag `v0.2.0`); 5 tools registered, `activate` pid 9428, applied live without restart. Final config: `model: gpt-6-luna`, `reasoningEffort: max`; R1 passed. Backups and rollback script are in place. |

## G0 note

Both halves of G0 passed: the structural half and the semantic half (real model recall, read/write tools, interrupt, auto-declined approval). The production advisor is accepted with `gpt-6-luna` + `reasoningEffort: max`; see [R1 report](../reports/2026-11-04-R1-real-codex.md). The only caveat is that a full DSH Host restart with real Codex was not rerun on production (to avoid disrupting the running app); the plugin restart harness and the real app-server resume cover the persistence path.

## Rollback (production desktop)

- `plugin_manager` → `remove_bundle` target `dsh-codex-advisor`.
- Or run `C:\Users\king_\.dsh\codex-advisor-rollback.ps1`, then restart DeepSeek Harness.

## Rollback (test profile)

```powershell
dsh plugin --profile advisor-test remove dsh-codex-advisor
```

Then remove `.scratch/advisor-test-state` if the evidence has been archived.
