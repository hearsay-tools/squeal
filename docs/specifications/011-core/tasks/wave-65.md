# Wave 65: quality scan of 0.1.379 to 0.1.387

Coordinator 6e3bce1c, 2026-10-31, at the human's request (status task a19e8156, decision card "Quality: Scan + evals now"). No product change is authorized. Host policy as in `wave-60.md`: no suite, no `squeal run --all`, no `pnpm run build`, no probe under the real HOME, never make CPU load on purpose.

## Q1: row 011-290

Use /quality. Shape: survey.

Outcome: one findings file that names what is dead, duplicated or misplaced in the work landed from release 0.1.379 to 0.1.387, as drop candidates, board rows and small slices.

Stretch: `squeal--v0.1.378..squeal--v0.1.387` (168 commits, 33 touch `src`). Rows: 011-262 (0.1.379); 015-99, 015-100, 015-101 (0.1.381); 011-271, 011-272, 011-279, 011-280 (0.1.382); 011-274 to 011-278, 011-282 (0.1.383); 011-283 (0.1.384); 011-285 to 011-287 (0.1.385); 011-288 (0.1.386); 011-289 (0.1.387); and the gh rows they shipped (board, "Triage"). Eval results and spec 018 research in the range are out of scope.

Do not repeat findings of `011-core/quality/2026-10-26-b.md` or `016-extensions/quality/2026-10-25.md`; name one only when this stretch changed it.

Focus, in this order:
1. The named-wait rule of 011-283 (`tasks/wave-62.md`, spec 011 status lines of 2026-10-31). The human asked for one owner. Is any older special case of named-wait order left beside `Promotions` (`src/core/scheduler/`), in the scheduler, `src/cli/status-wait*`, the store or the handover path?
2. The delivery prepare/commit split of 011-288 (`tasks/011-288/design.md`) across the five adapters (`src/harness/{shared,claude-code,codex,pi,opencode}`): is the commit point stated once, or copied per adapter? Is any older "told" path left that commits before the hand-off?
3. Anything else dead, duplicated or misplaced in the stretch, including 015-99 to 015-101 in `src/core/complexity` or `src/core/coverage`.

Owns: `docs/specifications/011-core/quality/2026-10-31.md` only (a 015-only finding may go to `015-coverage-complexity/quality/2026-10-31.md`). Leave alone: `src/`, tests, the board, any `spec.md` or `status.md`.

Done when: the file is committed alone, each finding names file and line, and each proposed row is in the board's column shape so the coordinator can paste it unchanged.
