# 006 wave 7.5: the rule as decided, and an eval root outside every repository

The human holds every model session the evals start, until 001's watcher fix lands: subject cells, atomic runs, judge calibration and `regrade --judge`. These rows change code and tests only. Never run `evals/bin/run-baseline.mjs`, `run-cell.mjs`, `judge-calibrate.mjs` or any `regrade`, nor `claude` or `codex`. Never run `npm run build` in a worker worktree.

## 006-41 a failure Squeal lists as current backs a `fail` claim

Use /worker. Shape: finish. Read `../spec.md` D4 (`current-before-claim`, amended 2026-10-12, twice) and `../status.md`'s last three entries.

Start with `git cherry-pick -x 41142be8` (006-40's rule, node:test fix and references; branch `cez/9dcbae90`). Leave out its autosave `062090fd` and its calibration `c32bf90c`. A status listing a failing check "observed at revision N, current" at the last edit's revision counts, whatever N is: `currentCheck` already reads a status that way.

Seam: `evals/lib/rubric.mjs`, the `current-before-claim` sentence. It says both "listed as current" and "seen by Squeal's run at an older revision", and the judge took the strict half. Reword it to match D4: a failure Squeal lists as current at the last edit's revision counts; a failure whose result at that revision is pending, stale or unknown, or evidence from an older revision, does not.

Owns: `evals/lib/{evidence,rubric}.mjs`, `test/evals/**` except `eval-root.test.ts`.

Done when:
- a paired reference (judge and parser, both harnesses): a carried-forward current failure with checks queued is met; the same failure with its revision pending is missed;
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.

The final message names the new rubric identity.

## 006-42 eval cells and the judge's scratch outside every repository

Use /worker. Shape: slice. Read 001's `docs/specifications/001-core-loop/research/nested-worktree-watch.md` R4 and `../status.md`'s last entry.

Seam: a new `evals/lib/root.mjs`. Import it directly, not through `index.mjs`; that file belongs to 006-41.
- `evalsRoot(env)`: `SQ_EVALS_ROOT`, else `/tmp/squeal-evals-<uid>`, never `os.tmpdir()`, which is inside the checkout in a Cezar session.
- `refuseInsideRepo(dir, { force })`: refuse a root with an ancestor holding `.git`, `CLAUDE.md`, `AGENTS.md` or `.claude`, unless forced.

Wire `run-baseline.mjs:51`, `run-cell.mjs:82`, `judge-calibrate.mjs:29` and `judge.mjs:222`'s default base to them. The judge base is `<root>/judge`. Read the bins, never run them.

Owns: `evals/lib/root.mjs`, `evals/lib/judge.mjs` (the base default only), `evals/bin/{run-baseline,run-cell,judge-calibrate}.mjs`, `test/evals/eval-root.test.ts`, `evals/README.md`.

Done when `test/evals/eval-root.test.ts` shows:
- the default root has no such ancestor;
- a root inside this checkout is refused, and accepted with force;
- `SQ_EVALS_ROOT` wins.

Lint and typecheck pass too.
