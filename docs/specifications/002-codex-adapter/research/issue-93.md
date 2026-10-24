# Issue 93: status-only handover news at Codex Stop

Researcher, 2026-10-24. Squeal 0.1.298 (`package.json`, worktree at `fb8a20889`). Brief: reproduce gh-93, documentation only, 20 minutes. Owner spec 002 D3 and D5; related 011 C8 and C9.

Host: one-minute load 36.14 on 24 online CPUs (`/proc/loadavg`, `nproc`), above the CPU count. No live Codex probe ran, for that reason and because the synthetic probe answered the question. The synthetic probe runs in process and starts no daemon or Codex.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does status-only handover news block Codex at Stop when every Stop gate is off? | Yes. Stop answers `decision: "block"` with the handover header as `reason`. Codex continuation is specified by D3 and reported in the issue; it was not run here. | verified by experiment (synthetic), 0.1.298 |
| 2 | Where does that come from? | Shared Stop counts a daemon liveness change as news; the Codex Stop maps news and block to the same `block`. | read in source code, 0.1.298 |
| 3 | Is it the design? | Yes. 002 D3 says news at Stop "always costs a continuation", and news includes a delta. It does not single out a liveness-only delta. | read in spec, 002 `spec.md` D3 |
| 4 | Does the synthetic run match the live incident? | The headline and the status sentence match the issue's text. The live incident itself was not re-run. | inferred |
| 5 | Can it loop? | The next Stop with `stop_hook_active` is silent in this fixture. Repeated live handovers were not tested. | verified by experiment (synthetic), 0.1.298 |

## Findings

**1. Synthetic reproduction.** Verified by experiment, 0.1.298. Probe `research/probes/issue-93/stop-handover.probe.ts`, run from that directory with `npx vitest run --config vitest.config.ts --reporter=verbose`. Result: 3 passed (`probes/issue-93/run-2026-10-24.txt`). Policy for every case: `{"stop":{"blockOnKnownFailures":false,"requireFullSuite":false,"requireSlowSuite":false,"waitMs":0}}`, the issue's configuration. All checks pass, nothing is pending, and the live daemon was already told at a PostToolUse.

- Control, no change: Stop stdout is empty.
- Handover begun (exit marker, exit note, claim to 0.1.296), old heartbeat fresh: stdout is empty. The liveness the hook computes is still `alive`, so nothing is new.
- Same, old heartbeat stopped as `#shutdown` leaves it: stdout is

  ```text
  {"decision":"block","reason":"SQUEAL · the daemon is handing over at revision 1\nRevision 1 (changed src/math.ts): 2 current (2 tests), 0 pending, 0 stale, 0 unknown. ... The daemon is handing over from 0.1.295 to 0.1.296 since 2026-10-24T21:56:55.357Z; 0.1.296 serves once the old daemon's lock frees; results are as of revision 1.\nKnown failures: 0; 1 test file current as of revision 1"}
  ```

  The next Stop, recorded `stop-hook-active` input, is silent.

So the trigger is the told liveness moving from `alive` to `down` with `stopping`. The handoff claim alone does not trigger it. Inferred: in the live incident the Stop may have come in the window after the old daemon stopped its heartbeat and before the successor registered.

**2. Code path.** Read in source code, 0.1.298.

- `src/core/delivery/delivery.ts` `deliver`: with `liveness: true` (every `onToolBoundary`, Stop included), `tests = delta.entries.length > 0 || changed !== null || holds !== null`, and `news = tests || code !== null`. A liveness change (`livenessChange`, `src/core/delivery/liveness.ts`) or a hold change (011 C8 as amended, row 011-73) alone makes a delta.
- `src/harness/shared/stop.ts` `newsText` returns that delta as text. `stopTurn` returns `{ news }` when no gate gives a reason. With every gate off, `blocking` is false and `reasons` is empty, so news is the only output.
- `src/harness/codex/handlers.ts:116`: `return block("block" in outcome ? outcome.block : outcome.news, deps.command);`. The committed bundle has the same line, `plugins/codex/dist/stop.mjs:9820`, as the issue says.
- Contrast, `src/harness/claude-code/hooks/stop.ts:26-27`: Claude Code sends news as `additionalContext` and only a block as `decision: "block"`. The shared comment in `stop.ts` notes that Claude Code also continues the turn on Stop context, so the cost there is not zero either. Not measured here.

**3. Spec position.** Read in `spec.md` D3 (Stop): "News is a delta, a first registration carrying known failures, or a policy block; it goes out as `{"decision": "block", "reason": <report>}` ... Stop has no `additionalContext`, so news at Stop always costs a continuation." The code follows D3. gh-93 asks to change D3: a delta that carries no test transition and no action should not be news at Stop. D5 is involved only because the rule lives in shared code (`delivery.ts`, `stop.ts`) that both adapters use.

Task 001-224 already applies this idea to one kind of delta: "news at Stop costs a continuation, so the edit line only rides on other news" (`stop.ts` `newsText`; `delivery.ts` `delivered = news || (liveness && !stop && ...)`). Liveness and hold changes have no such exception. Inferred.

**4. What the handover text asks of the agent.** Read in source code. The "handing over ... serves once the old daemon's lock frees" sentence names no action. An overdue handoff adds "`squeal start` finishes it" (`test/status/stopping.test.ts:132-135`), which does name an action. Not probed here.

## Recommendation for Squeal

Decision needed (002 D3, shared with 011 C8/C9 delivery): whether a Stop delta whose only content is a liveness or hold change, with no transition and no unmet gate, stays news. The narrow option is a Stop-only rule like 001-224's: at `stop`, a liveness or hold change does not by itself make `delivered` true. It stays untold and goes out at the next PostToolUse or UserPromptSubmit. Things to settle first:

- Which liveness changes carry an action: daemon down with no successor, overdue handoff (`squeal start`), a short handoff (row 011-140). Those may still need to reach the agent before it ends.
- Whether Claude Code keeps sending this as `additionalContext` at Stop, or follows the same rule.
- The waiter wake (001-85): a silent Stop ends the turn, so an idle agent hears the change only on its next prompt.

## Limits and open questions

- Synthetic only: fixture store, recorded `codex exec` input, the handler in process. Codex's own reaction to the `block` (one more model turn) is from D3 and the issue, not re-run.
- The issue's exact revision, counts and versions differ from the fixture; only the shape is matched.
- Not determined: how often a Stop falls into the window between the old heartbeat stopping and the successor registering, because no live handover was timed here.
- Hold changes (row 011-73) take the same path by the code but were not probed.

## Sections touched

None edited. Read: 002 `spec.md` D3, D5; 002 `status.md`; 011 `spec.md` C8, C9. No hold was changed.

## Sources

- gh-93, https://github.com/hearsay-tools/squeal/issues/93 (`gh issue view 93 -R hearsay-tools/squeal`, read 2026-10-24).
- `src/harness/codex/handlers.ts` (Stop), `src/harness/shared/stop.ts` (`stopTurn`, `newsText`), `src/core/delivery/delivery.ts` (`deliver`), `src/core/delivery/liveness.ts` (`livenessChange`), `src/core/status/stopping.ts` (`withStopping`), `src/harness/claude-code/hooks/stop.ts`, `plugins/codex/dist/stop.mjs`, at `fb8a20889`.
- Probe: `research/probes/issue-93/` (README, `stop-handover.probe.ts`, `vitest.config.ts`, `run-2026-10-24.txt`).
