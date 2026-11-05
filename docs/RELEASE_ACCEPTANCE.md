# Release acceptance — dsh-codex-advisor 0.5.1

Status: **accepted for production** (2026-11-05 09:52 +0800); live desktop 0.5.1, new client UI and update check verified after the 09:43 full restart.

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
node --test --test-force-exit test/jsonrpc.test.mjs test/store.test.mjs test/codex.test.mjs test/manager.test.mjs test/manifest.test.mjs test/update.test.mjs test/client.test.mjs
```

Result: **29 pass / 0 fail** (2026-11-05). Coverage: JSON-RPC framing/correlation/timeout/abort, state atomicity/digest/eviction, thread start+resume across fake-app-server restarts, missing thread, writer conflict, interrupt, auto-declined approvals, activity files/commands, quota preflight, poll, cancel, reset, manifest/patch/locale checks, update cache invalidation, and client card/panel render smoke.

## L2 — Host-level harness

Command:

```powershell
node test/harness/host-level.mjs
```

Result: **PASS**. The plugin's `apply` was invoked with a stub Cordis context; six tools registered; `codex_ask` completed two turns on one fake thread; `codex_status` reported `state=ready`; `codex_reset` produced a new thread; dispose closed the child.

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

## L5 — production desktop (desktop-kfscv8c-1, 2026-11-05)

Host `DESKTOP-KFSCV8C`, user `king_`, DSH `0.2.1-rc.5`, profile `desktop`.

| Check | Result | Evidence |
|---|---|---|
| pre-install backup | PASS | `package.json`, `cordis.patch.yml`, `pnpm-lock.yaml` → `.bak-20261104-codex-advisor`; rollback script `C:\Users\king_\.dsh\codex-advisor-rollback.ps1` |
| install via `plugin_manager` | PASS | initial 0.1.0, upgraded to 0.2.0, 0.3.0, 0.4.3, 0.5.0, then **0.5.1 cleanly from tag `v0.5.1`** (`application=applied`; dependency updated to the tag; GitHub release published); 6 tools; Host 0.5.1 |
| 0.5.2 visual polish (release) | READY (not installed) | tag/release `v0.5.2` adds a clearer no-session card (`未打开会话 / 打开一个会话后可用`) and a simpler Codex panel header/source line; 29/29 tests; isolated web-app screenshots; production remains 0.5.1 live, install stays a user/plugin-manager action |
| tools registered | PASS | Host `Tool.listTools` includes `codex_ask`, `codex_poll`, `codex_cancel`, `codex_status`, `codex_history`, `codex_reset` |
| model/effort config | PASS | acceptance `model: gpt-6-luna`, `reasoningEffort: low`; after R1 switched to `reasoningEffort: max` (activate `2026-11-04T07:12:50.369Z`) |
| activation | PASS | `events.ndjson` → `{"event":"activate","pid":9428,...,"t":"2026-11-04T04:03:04.084Z"}`, reloaded `05:14:06.755Z`, `07:12:50.369Z`, `08:34:43.974Z` (0.3.0), after restart `14:45:52.875Z` (pid 41584), 0.5.0 at `16:42:14.121Z`, clean 0.5.0 at `17:42:00.958Z`, 0.5.1 at `17:51:26.672Z`, and live 0.5.1 at `2026-11-05T01:43:55.471Z` (pid 50980; app started 09:43:49 +0800) |
| GitHub release | PASS | `v0.5.1` release published: https://github.com/Awenforever/dsh-codex-advisor/releases/tag/v0.5.1 ; remote main `e49633e` |
| provenance / history (L1) | PASS | every result, including failures, carries `source` (`codex-advisor`, plugin 0.5.1, model, effort); `codex_history` on real thread `01a1a54c-e261-7123-979e-3544042de507` returned 2 turns with asks/answers, `model=gpt-6-luna`, `effort=max` |
| L2 client tab | PASS (live) | slots: `conversation.view` occupant `codex-advisor` order 20 active; production app shows `对话 / 轨迹 / 看板 / Codex` and the new 0.5.1 Codex panel |
| L2 sidebar card | PASS (live 0.5.1) | `sidebar.footer.action` occupant `codex-advisor-card`; production screenshot shows `Codex 顾问 / v0.5.1 / 尚未使用 / gpt-6-luna · max` at the sidebar foot; no raw thread id |
| L2 host routes | PASS | `snapshot` 200; `history` 200; deferred `webServer` registration (0.4.3); update route live after restart |
| L2 update check | PASS (live 0.5.1) | `GET http://127.0.0.1:32024/plugins/dsh-codex-advisor/update` → `{"currentVersion":"0.5.1","latestVersion":"0.5.1","updateAvailable":false,"checkedAt":"2026-11-05T01:44:02.436Z","releaseUrl":".../v0.5.1"}`; 6h cache; 5-min client retry; 15s/60s request bounds |
| L2 update-cache invalidation | PASS (code + live) | `checkForUpdate` invalidates when `currentVersion` changes, supports `force`, and `apply` calls `resetUpdateCache()`; live route refreshed after the 09:43 restart |
| L2 client reliability | PASS | client registration/render smoke; per-request AbortController timeouts; update retry; locale-aware tab label (`label: () => t('tab')`); version displayed from the live Host `source`, not a stale update-check cache; no raw thread ids |
| L2 UI redesign | PASS (live 0.5.1) | the running renderer now has the card/panel redesign after the 09:43 full restart; an isolated web-app instance on a copied profile also rendered the card and empty Codex trail without touching production |
| tests | PASS | 29/29 offline tests; L2 harness PASS; failure-path harness PASS (`CODEX_MODEL_UNAVAILABLE`, `poll.last_failure`, `last_failure`, `history.turns[].error`) |
| CI workflow | PASS | `.github/workflows/ci.yml`; Windows `windows-latest` + Node 22; 29 unit tests + Host harness + failure-path harness; `e49633e` 2 runs success; https://github.com/Awenforever/dsh-codex-advisor/actions/workflows/ci.yml |
| L2 live turn | FAIL (external network) | current session thread `01a1a712-a25b-7791-a0de-1ac1f6695911` turn failed: `workspace routing discovery failed` / `codex_error_info: other`; `https://chatgpt.com` still times out (curl 000 at 09:52). Not a plugin/UI failure. |
| restart | PASS (live 0.5.1) | full DSH restart at 2026-11-05 09:43:49 +0800; bridge version 0.5.1; `/update` refreshed to latest 0.5.1 |
| real Codex semantic (R1) | **PASS** (2026-11-04 14:42–15:13 +0800) | `gpt-6-luna` + `low`: spike thread `01a1a54b-aeb4-7502-83d2-cf4c0b9b2488` (read-only tool, app-server resume, recall `AMBER-WALRUS-5078`, interrupt); approval thread `01a1a556-19b5-7d60-ad90-ffae77fda0fd` (`declinedApprovals=1`, command declined); production thread `01a1a54c-e261-7123-979e-3544042de507` two turns; write file `.scratch/advisor-r1-write.txt` = `R1-WRITE-OK`; details in [R1 report](../reports/2026-11-04-R1-real-codex.md) |
| max switch | PASS | profile patch `reasoningEffort: max`; plugin reload; `codex_status` → `config.model=gpt-6-luna`, `config.reasoningEffort=max` |
| rollback | ready | `plugin_manager remove_bundle` target `dsh-codex-advisor`, or the rollback script |

## Four required scenarios

| Scenario | Offline / Windows / model-driven (fake Codex) | Real DSH + real Codex |
|---|---|---|
| S1 same thread two rounds | PASS (manager test; Windows L2; real DSH model: same `thread_id`, history `0 → 1 → 2`) | PASS (production thread `01a1a54c…`: two turns, same thread, no errors) |
| S2 mid-course change | PASS (same-thread conversation; fake history increments; model observed prior turns) | PASS (same-thread follow-up in production; spike turn 2 recall) |
| S3 final acceptance | PASS (model used the accumulated thread across three calls) | PASS (spike recalled `AMBER-WALRUS-5078`; production turn 2 answered call 2) |
| S4 DSH restart / recovery | PASS (model-driven `--session-id` resume in a new Host: same thread, `history=1`; Windows restart harness; fail-closed digest on thread loss) | PASS (real app-server restart/resume; plugin restart harness; production 0.5.1 full restart at 09:43; same persisted state) |

## Known residuals (R1–R6)

| ID | State | Detail |
|---|---|---|
| R1 | closed (2026-11-04 15:13 +0800) | Real Codex: app-server resume, recall `AMBER-WALRUS-5078`, read-only command, write `R1-WRITE-OK`, `turn/interrupt`, approval declined; production two turns on one thread; no quota error. Details in [R1 report](../reports/2026-11-04-R1-real-codex.md). |
| R2 | closed | Isolated-profile model-driven e2e ran with `USTC1_API_KEY` injected into the headless process environment only (never written to disk/profile/logs); S1–S4 passed against the fake app-server. |
| R3 | closed (2026-11-03 12:09 +0800) | `win11-test`: bundle installed; desktop composition and real app launch verified. The app runs as `Administrator` in `SessionId=1` via an interactive scheduled task (`New-ScheduledTaskPrincipal -LogonType Interactive`), plugin `activate` pid 5800, CDP `http://127.0.0.1:9222/json` HTTP 200, page `dsh-app://app/`. The VMware blank-password boundary is irrelevant to this path. |
| R4 | closed (2026-11-05 09:52 +0800) | Production `desktop` cleanly installed `dsh-codex-advisor` **0.5.1** from tag `v0.5.1`; dependency updated; GitHub release published; 6 tools; 29/29 tests + CI green; new client UI live after the 09:43 full restart. |
| R5 | closed (2026-11-05) | Sidebar card is visible in the user's screenshot at the sidebar foot; the earlier absence was a layout/scroll state, not registration. |
| R6 | open (external) | Live Codex turn failed with `workspace routing discovery failed` while `chatgpt.com` timed out; retry when the network recovers. |

## G0 note

Both halves of G0 passed: the structural half and the semantic half (real model recall, read/write tools, interrupt, auto-declined approval). The production advisor is accepted with `gpt-6-luna` + `reasoningEffort: max`; see [R1 report](../reports/2026-11-04-R1-real-codex.md). A full DSH Host restart on 2026-11-05 09:43 loaded 0.5.1 cleanly and the new card/Codex tab/update route are live; only a fresh real-Codex turn remains blocked by the external `chatgpt.com` timeout (R6).

## Rollback (production desktop)

- `plugin_manager` → `remove_bundle` target `dsh-codex-advisor`.
- Or run `C:\Users\king_\.dsh\codex-advisor-rollback.ps1`, then restart DeepSeek Harness.

## Rollback (test profile)

```powershell
dsh plugin --profile advisor-test remove dsh-codex-advisor
```

Then remove `.scratch/advisor-test-state` if the evidence has been archived.
