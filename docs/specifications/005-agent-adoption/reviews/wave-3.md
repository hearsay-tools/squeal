# Wave 3 review (005-33)

## Verification output

Reviewed product candidate: `2247281c2b6382f1084e749a13e8296e75a9c8a2` (0.1.146). Actual clean checkout at verification start: `b36a5b5bf96da5a28d2b1fcc9eb59cedc1f9470a`. Only board and 001 review documents differ after the candidate; `git diff 2247281c..b36a5b5b --name-only` confirms no product differences. The HEAD mismatch is reported below. Scope is 005-21, 005-15, 005-19 and their build; 001 and 006 work is excluded.

```text
$ npm ci
added 56 packages, and audited 57 packages in 3s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.146 lint
> biome check .
Checked 977 files in 2s. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.146 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.146 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.146 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(empty after build)

$ npx vitest run
IN PROGRESS: independent full run started on the clean checkout.
```

Npm emitted its existing `store-dir` configuration warning and install-script notices for esbuild and @parcel/watcher. Full-suite output will be appended when it ends. At 15:21 UTC the host load was `201.95 103.12 75.43`; timing failures are already appearing. They are not a proven break by this wave.

The verification above is at the actual checkout, not the literal candidate SHA, so is **unverified for the exact candidate** under the reviewer rule. The product tree is identical. Probes use only ignored scratch directories inside this worktree (`node_modules/.review-00533`), synthetic store data and stub CLIs in a scratch HOME. No model or real harness session ran. No source changed.

## Verdict

**FAIL**: 3 proven blockers, 0 should-fix items, 1 proven nonblocking scope note. This initial report preserves the three reproduced issues before extending the review. Only a proven spec or done-when break blocks.

## Blockers

### B1. Proven: inherited counts and delivery titles still combine tests and file checks

**Locations:** `src/core/status/format-status.ts:57`, `:84`; `src/core/delivery/format.ts:125`, `:339`, `:340`; the aggregate originates in `src/core/state/header.ts:73`.

**Contract:** D1: "Every count of checks a checkpoint, `status` or a header prints names its tests and file-level checks apart." 005-21 promises "every count" and 005-33 explicitly includes model-facing delivery headers.

**Smallest proof:** seed one current test and its file-level check, both inherited from the same other worktree, then call the real `readHeader`, `headerLines`, `readStatus`, `formatStatus` and `formatDelta`:

```text
Revision 1: 2 current (1 test, 1 test file loaded), 0 pending, 0 stale, 0 unknown. Inherited: 2 of 2 current.
Inherited from other worktrees: 2 current results
  2 from other at abcdef1
SQUEAL · 2 checks changed at revision 1
```

The primary validity count is correct, but the inherited subset/source counts and delivery title do not name the parts. A model can still read those two results as two tests. Baseline titles and grouped recovery/unknown/overflow counts use the same unsplit check-count pattern.

**Worker-sized fix:** finish 005-21's formatting pass in status/delivery and their tests. Carry inherited file-level counts (including per source) through the header/snapshot; reuse `countChecks`/`checkPartsText` for delta titles and grouped/overflow counts. Preserve the 10,000-character cap and test mixed test/file entries rather than only the primary validity line.

### B2. Proven: the new skill promises a re-run for forced failures that are not re-run

**Locations:** `plugins/claude-code/skills/squeal/SKILL.md:15` and identical Codex copy; mechanism boundary `src/core/scheduler/rerun.ts:72` (read-only evidence, not a finding against pre-existing scheduler code).

**Contract:** D6 makes the skill explain the automatic re-run; 005-33 asks whether "any primer or skill sentence claim[s] what Squeal does not do (… the re-run once and its exceptions)". Vision: trustworthy state and evidence over optimistic claims.

**Smallest proof:** call real `queueReruns` with the same eligible fast file and fresh key, `rerunCap: 8`, changing only `forced`:

```text
forced=false, eligible ordinary file, queued=1, enqueue calls=1
forced=true, eligible ordinary file, queued=0, enqueue calls=0
```

The skill says "Squeal re-runs a new failure once on its own (not a slow file's, nor when more than eight fail anew at once)" and tells the agent to let that re-run answer. A fresh failure in `run --all --force` or a warm-up is excluded by the scheduler even with one fast file; the promised follow-up never arrives. A key already re-run is excluded too.

**Worker-sized fix:** qualify the sentence in both skill copies to match `queueReruns`' eligibility (ordinary, not forced, not already re-run at the same key, not slow, within cap). Test the actual exceptions in the text contract; do not change scheduler policy to fit the prose. Keep the skill copies identical and within the size budget.

### B3. Proven: declining both harnesses cannot be passed back by the setup skill

**Locations:** `plugins/claude-code/skills/setup/SKILL.md:16`, `:20` and identical Codex copy; CLI seam `src/cli/setup/command.ts:101`.

**Contract:** goal 3: "Nothing is written without a yes." D3 "The skill", step 4: "Apply with `squeal setup --yes` and one flag per answer." 005-19 must map every answer to a flag.

**Smallest proof:** with executable `claude` and `codex` stubs on PATH and isolated HOME/config roots, follow the table for "no" to both harness questions: omit both `--harness` flags, apply `--yes --no-warmup --block none --slow none --no-trust`.

```text
omitted harness flags exit=0 Claude settings=true
Set up Claude Code here (on the PATH, plugin not installed)?
  yes (default, --yes)
Set up Codex here (on the PATH, plugin not installed)?
  yes (default, --yes)
--harness none exit=2
squeal setup: --harness takes claude-code or codex, not "none"
```

No flags means `given.harnesses = null`, so `--yes` takes defaults. Both explicit declines are lost; `.claude/settings.json` is written anyway. This is a new skill/CLI mismatch, not an audit of old setup defaults.

**Worker-sized fix:** add an explicit empty-harness answer (for example `--harness none`, exclusive with named harnesses), parsing it to `[]`, and document that mapping in both skills. Cover both declines with the actual setup command in scratch homes; assert neither harness config is written while separately accepted config/gate choices can still apply.

## Should-fix

None yet. The completed-checkpoint join inference is being probed separately: equal end timestamps do not themselves record a join.

## Nits and scope notes

### N1. Proven, nonblocking: checkout HEAD differs from the build candidate

`git rev-parse HEAD` was `b36a5b5b`, not `2247281c`. The intervening files are only `docs/board.md` and 001's review documents. Report this provenance difference; do not repair board/status or include 001/006 changes in the fix wave. No product mismatch was found.

## What fits

- Main current/pending/stale/unknown counts use `fileLevelCounts`; status outcome/phase counts have the same split through the shared formatter. The mixed-count probe proves the primary current/pass line sums correctly.
- Registration's nonzero `Known failures` uses the actual check identities via `failureCountText`, rather than guessing the unit.
- The setup skill has identical copies, reads the JSON plan, prints questions without a terminal, and explicitly ends a session that cannot ask before apply. No model-based compliance claim is made.
- `--slow none` represents the all-not-slow answer, and is exclusive with positive slow/input answers. The remaining missing empty choice is harness selection (B3).
- Build completed without tracked bundle drift.

## Inputs for the fix/next wave

1. Counts worker: preserve `readHeader`/snapshot's same-revision store read and add the inherited split at that boundary. Formatting should consume exact check identities when it has them. Do not infer file counts from paths or drop the combined total. Keep the 10,000-character delivery cap.
2. Text worker: change only the new re-run wording and its parity/size tests. `queueReruns(context, ledger, failures)` is the source of truth; forced and already-re-run keys are excluded before the cap is applied. No scheduler-policy change is requested.
3. Setup worker: parser must distinguish unanswered (`null`) from declined-all (`[]`); run `setup --plan --json`, interview, then apply with an explicit flag for every answer. Gates remain applied before blocks; `--no-warmup` remains on the apply command when the skill handles warm-up separately. Never stage/commit during setup.
4. Next proof wave owns real harness sessions. This review runs none. Confirm noninteractive no-write behavior there; preserve the stated 1,500-character primer and skill size budgets.
