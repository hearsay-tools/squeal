# Wave 29.5: `squeal reach` before its release (0.1.416)

**Approval.** The human approved this on 2026-11-07 in task f3b0d84b, on these cards:
- review round 3, "A: land, fix in 0.1.416";
- P1, "re-read once, automatically";
- P11, "Second list. A repo that just installed squeal may not have that data".

Coordinator f3b0d84b. The base is main with 0.1.415 landed. Two workers run in parallel on disjoint files; there is one candidate, then one review. Nothing is released before this wave's review passes.

**For every row.**
- Read spec 015 D11, and the review files `reviews/0.1.415.md`, `-r2.md` and `-r3.md`.
- Read `lessons.md` "Edit reach, round 1".
- Import from defining modules: Biome forbids barrels.
- No result key, `KEY_FORMAT_VERSION` or `user_version` change. `test/keys/key-format.test.ts` must pass.
- Run no full suite and no `pnpm run build`.
- Before you finish: lint, typecheck and `squeal status --wait 60000 <changed paths>`.

## Worker A (resume badb9468): 015-119 and 015-117, the daemon and store side

**015-119, a walk read before an edit is never stored under the newer key** (review r3, B2-R3).
- Use the scheduler's existing freshness decision for runner parts (`applyRunnerPart`, `src/core/scheduler/refinement.ts`) to decide which walks are bound to a key. A part that the scheduler judged changed-meanwhile stays unrecorded until the carried fresh part supplies it. Environment walks follow the same rule.
- Do not simply overwrite every row: a stale writer must not replace a fresh one either.
- Done when the review's overlapping-refinement case passes. That case keeps the closure path set unchanged, waits until the scheduler is idle and the results are current, and checks the graph at the current key. It goes through the real scheduler and the real Vitest adapter.

**015-117, re-read the imports once after an upgrade** (P1, `lessons.md` defect 1).
- After its start-up work and the baseline, the daemon re-walks, once, every test file whose current key has no stored walk.
- It runs no test and changes no key. It yields to edits and tiers, as refinement already does.
- It runs once per daemon version, by a marker in the store.
- Done when:
  - a store with closures and no walks gets walks for every listed test file, without a run;
  - an edit during the walk wins;
  - a second start does not walk again.
- Report the CPU cost on this repository, with the load.

**Owns:** `src/core/scheduler/**`, `src/core/store/**`, `src/runners/vitest/**`, `src/core/types/runner.ts`, and their tests. If the validity cases need it, `test/keys/validity/**` too, in its own commit.

## Worker B (new): 015-116 and 015-118, the report side

**015-116, defects P2 to P10 and P12** (board row 015-116, scope as written there; `lessons.md` defects 2 to 10 and 12). Also cover `mainKind.<sort>` (`src/cli/reach-format.ts`), which Squeal flags as untested.

**015-118, a second list by real-edit cost.**
- The list ranks entries by re-run seconds summed over the window's edits.
- With no edits recorded, it says so in one line and does not rank.
- `--limit` and `--json` apply to it as to the other lists.

**Owns:**
- `src/core/reach/**`
- `src/cli/reach*.ts`
- `src/core/store/repos/edits.ts`
- the three `plugins/*/skills/squeal/references/commands.md`
- `test/reach/**`

**Leave alone:** Worker A's files. The report reads the graph through `readImportGraph(store, worktreeId).walk(testFile)`. If Worker A must change that port, I relay it.

**Done when:**
- there is a fixture regression for each item;
- the proof's squeal and cezar outputs (`research/probes/reach-proof/report-*.txt`) show no case from P2 to P10 or P12 when re-read with the fixes.
