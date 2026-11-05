# Wave 9: lint groups at `pause` and `stop` (row 019-45)

The human, 2026-11-05: "Fix: Yes, build and release", after finding that 0.1.402 accepts `{ "lint": true, "at": "stop" }` and ignores it.

## 019-45

Use /worker. Shape: slice. Model: claude opus, effort xhigh.

Outcome: a lint group at `pause` or `stop` stops linting edited files at each edit, lints them when the agent pauses, and at `stop` Stop waits for that lint and tells its findings once; no lint group field is accepted and then ignored.

Read: `spec.md` D1 (lint groups, moments; the 2026-11-05 amendment), D4 (Stop), D5 step 1 (the commit hold this generalizes); 017 D5 and D8 (lint at Stop, `lint.blocking`); `status.md` 2026-11-05.

Seam and first edit: `src/core/lint/pass/commit-entry.ts` (`lintGroupOf`, `markHeld`, the `at === "commit"` checks at lines 49 and 126): hold a path for any group not at `edit`; release a `pause`/`stop` hold when `consumersIdle` (`src/core/lint/pass/idle.ts`) is true, as the slow lane's `"idle"` wait does (`src/core/scheduler/slow-tier.ts` `#publishUntriggered`). Then Stop: `src/core/state/required.ts` (today "test files only") and `src/core/slow/stop-wait.ts` request and wait for a `stop` lint group (`run-lint-group.ts` already runs one), and tell findings by 017 D8 (one hold; more only under `lint.blocking`, counted in `stop.maxHolds`).

Owns: `src/core/lint/pass/**`, `src/core/state/required.ts`, `src/core/slow/stop-wait.ts`, `src/core/daemon/policy-checks.ts`, the lint/Stop wording in `src/harness/shared/text.ts` and status lines for held lint, and their tests. Leave alone (peer 48454288, spec 011 wave 70): `src/core/presence/**`, `src/core/delivery/{liveness,format,header}.ts`, `src/core/ps/**`, `src/harness/shared/ensure.ts`, `src/cli/start.ts`, `src/core/status/open-runs.ts`. Ask before editing any other file outside the list.

Done when, as tests (each red before): (1) a lint group at `pause`: an edit lints nothing, status says lint waits for the agent's pause, the pause lints the file and delivers its `FAIL lint` line once; (2) at `stop`: Stop starts and waits for the lint, then tells the finding once, Claude Code and Codex fixtures; `lint.blocking` false holds once, true keeps holding up to `stop.maxHolds`; (3) a lint group key or moment the code does not honour (for example `after`, `quietMs` or `limits` on a lint group, if left unbuilt) is a loader problem naming the group, not silently ignored; (4) commit and edit lint groups unchanged (existing tests pass). Lint, typecheck, affected tests via `squeal status --wait 60000 <paths>`; no build.
