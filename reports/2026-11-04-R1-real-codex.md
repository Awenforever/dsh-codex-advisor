# R1 — real Codex semantic verification

- Date: 2026-11-04, 14:42–15:13 +0800.
- Host: `DESKTOP-KFSCV8C` (`desktop-kfscv8c-1`), Windows 11, user `king_`.
- DSH: `0.2.1-rc.5`; Codex: `0.166.0-alpha.5.1`.
- Model/effort: `gpt-6-luna` + `low` during acceptance; `max` after acceptance.
- Quota at start: `ordinaryUsageAllowed=true`, primary/secondary `usedPercent=0`; two reset credits were available and unused.

## 1. Spike: persistence, tools, resume, interrupt

Run: `spike/appserver-probe.mjs` with `CODEX_PROBE_MODEL=gpt-6-luna`, `CODEX_PROBE_EFFORT=low`.
Run directory: `spike/runs/2026-11-04T06-42-42-443Z`.

| Check | Evidence |
|---|---|
| non-ephemeral thread | `01a1a54b-aeb4-7502-83d2-cf4c0b9b2488`, `ephemeral=false` |
| turn 1 + read-only tool | turn `01a1a54b-c150-7362-be24-07a479906843`, completed; answer `stored:FIXTURE-LINE-OK`; item summary includes `commandExecution` |
| process restart + resume | server B `thread/resume` returned the same id; `thread/loaded/list` contains it |
| turn 2 recall | turn `01a1a54d-eba5-72f0-879f-0d6cb4d1dfed`, completed; answer `AMBER-WALRUS-5078` |
| bogus resume | `-32600 no rollout found for thread id ...` |
| interrupt | turn `01a1a54f-c5d0-7011-87b0-69098416dbea`; `turn/interrupt` → status `interrupted`, 1520 ms |

## 2. Real approval decline

Run: `spike/approval-probe.mjs` with the same model/effort; thread `approvalPolicy=on-request`, `sandbox=read-only`.

- Thread: `01a1a556-19b5-7d60-ad90-ffae77fda0fd`.
- Turn: `01a1a556-2be9-7bc0-9811-da131264c546`.
- A command execution approval request arrived; the client returned `{decision:"decline"}`.
- `declinedApprovals=1`; command status `declined`; no file was written.
- Turn status `interrupted` after the decline (expected for this probe).

## 3. Production plugin smoke

Plugin `dsh-codex-advisor 0.2.0` in the `desktop` profile; `codex_status`:

```json
{"config":{"sandbox":"workspace-write","approvalPolicy":"never","model":"gpt-6-luna","reasoningEffort":"low"},"tools":["codex_ask","codex_poll","codex_cancel","codex_status","codex_reset"]}
```

- Thread: `01a1a54c-e261-7123-979e-3544042de507`.
- Turn 1: `01a1a54c-e471-7551-941c-526a08819b7a`, completed, answer `R1-OK.`
- Turn 2: `01a1a54f-62fd-7aa3-b3d3-4b0c1cc8a932`, completed, answer `This is call number 2 in the same advisor thread.`
- Same thread id for both turns; two distinct turn ids; no `CODEX_QUOTA_EXCEEDED` or other error.

### Write tool

- Thread: `01a1a55b-8ca7-75f3-8c82-c2b4c1b5e7b9`; turn `01a1a55b-8d18-7572-b9d3-6b03009c80c0`.
- Prompt: create `.scratch/advisor-r1-write.txt` with `R1-WRITE-OK`.
- The `codex_ask` returned `status=running` at the 120 s wait; a later `codex_poll` returned `idle` with no final message body.
- The file exists and contains `R1-WRITE-OK` (11 bytes, 2026-11-04 15:03:09 +0800), so the write tool succeeded; the final wording was not collected.

## 4. Production switch to max

- Backup: `cordis.patch.yml.bak-20261104-max`.
- Profile patch: `model: gpt-6-luna`, `reasoningEffort: max`.
- Plugin reloaded: `activate` at `2026-11-04T07:12:50.369Z`.
- `codex_status` after reload: `config.model="gpt-6-luna"`, `config.reasoningEffort="max"`, five tools present.

## Verdict

R1 **PASS**:

- real model recall across an app-server restart;
- read-only tool execution;
- write tool execution;
- `turn/interrupt`;
- real approval request auto-declined;
- production `codex_ask` two turns on one thread, no quota error.

Remaining caveats:

- A full DSH Host restart with real Codex was not rerun on production to avoid disrupting the running app; the plugin restart harness (fake Codex) and the real app-server resume above cover the persistence path.
- The write turn's final answer text was not collected; the file content is the direct evidence.
