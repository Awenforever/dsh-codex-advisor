# L2 UI plan — Codex Advisor as a session tab

Status: L2 implementation in 0.4.3 — tab live; sidebar card registered but its visual placement is unresolved. Evidence: `reports/2026-11-04-L2-ui.md`.

## Implementation status (2026-11-04)

- `conversation.view` / `codex-advisor` is active; the Codex tab renders source, model, effort, thread, turns and the ask card.
- `sidebar.footer.action` / `codex-advisor-card` is registered. It was not visible in the captured window; the USTC card in the same slot was also absent, so the shared sidebar footer is below the fold or not rendered in that expanded layout.
- `conversation.composer.dock` / `codex-advisor-session-probe` is active.
- Host routes `snapshot` and `history` return 200. Registration now waits for the `webServer` service instead of running once at activate time.
- A live `codex_ask` turn failed with `workspace routing discovery failed` while `chatgpt.com` timed out (curl 000). The failed turn is visible in the tab; this is external network, not the UI path.

Residual: confirm the card after scrolling/collapsing the sidebar; if it stays hidden, move a compact status to the composer dock or a session-row badge, or add the footer layout treatment used by the USTC card.


## Slot evidence

Live Client `Slots.listSubTree` shows:

| Slot | Kind | Scope | Meaning |
|---|---|---|---|
| `conversation.view` | list | session | "Registered Conversation target Views, rendered one at a time"; registration `id`/`order`/`label` |
| `conversation.session` | single | session | strict per-Session conversation body; parent of `conversation.view` |
| `main` | keyed | root | central panel selected by sidebar entry id; global, not per-session |
| `sidebar.panellist` | list | root | global panel icons |

The DSH session header in the screenshot (对话 / 轨迹 / 看板) is the `conversation.view` pattern, not a sidebar panel: views are per-session and rendered one at a time.

## Decision

**Recommended: tab-first via `conversation.view`.** Register a view:

- `id: codex-advisor`
- `label: "Codex"` (localized)
- `order`: after the shipped conversation/trajectory views
- component: a per-session Codex timeline

This gives the natural "轨迹/看板" placement, keeps the conversation column intact, and avoids a global panel that competes with the conversation.

**Optional companion badge:** a small provenance marker (for example in `sidebar.session.row.leading` or `conversation.chat.turnTail`) showing "Codex reviewed" / unread state. This is additive and does not duplicate the timeline.

**Not recommended as the primary UI:** `sidebar.panellist` + `main` keyed panel. It is global (not per-session), consumes the central area, and would duplicate the conversation tab. It is only justified for a cross-session dashboard later.

Both tab and badge are technically possible; if both are built, keep the tab as the source of truth and the badge as a two-state indicator, not a second full history view.

## Data path

The current plugin is Host-only. The tab needs a Client half plus a read path:

1. **Host API** (preferred): expose a read-only route/service that returns the same payload as `codex_history` (`thread_id`, model, effort, turns, commands, files, source). Reuse the manager's `history` method; authorize by the existing DSH session/workspace context; no new listening port.
2. **Client view**: register `conversation.view`; get the current session id from the view props; fetch the Host payload; render:
   - header: source badge, model/effort, thread, quota;
   - turn cards: status, ask, final answer, commands, files, declined approvals;
   - empty state: "No Codex turn in this session yet";
   - refresh on tool completion or explicit button.
3. **Badge** (optional): mark the session row when the latest completed turn has a Codex answer; keep it non-interactive.
4. **Verification**: install in the live profile, open the tab in the DSH Web UI, exercise a real turn, and confirm the timeline matches the `codex_history` payload. No mock HTML.

## Risks / costs

- Client bundle build and slot registration are separate from the Host tool code; packaging must add a Client entry to the bundle.
- The Client must not read Codex state from the filesystem directly; use the Host API so Windows paths/permissions stay in the Host.
- The view must tolerate a missing app-server/thread (show empty state, no crash).
- The tab must not duplicate the chat transcript; it should show only Codex-originated turns and provenance.
- L1 `source` fields are the contract; the L2 view should render them, not invent provenance.

## Phases

1. **L1 (done in 0.3.0)**: `source` on results, `codex_history`, attribution instruction.
2. **L2a**: Host read API + contract tests.
3. **L2b**: Client `conversation.view` timeline; verify in the live page.
4. **L2c (optional)**: session-row badge / unread indicator.

The tab is the default destination; the sidebar panel is deferred unless a cross-session dashboard is explicitly requested.
