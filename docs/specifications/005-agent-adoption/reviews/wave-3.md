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
INTERRUPTED by the coordinator (SIGTERM, shell observed exit 143).
The uncapped run reached 52 workers and host load 323; it has no full-suite verdict.

$ npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/b2b02654-06c3-4ecd-9447-797745a75240

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/b2b02654-06c3-4ecd-9447-797745a75240/test/fixtures/scheduler/.tmp/00a75699-be49-4aab-8b5f-49020f4502fb/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/b2b02654-06c3-4ecd-9447-797745a75240/test/fixtures/scheduler/.tmp/40bc0813-dbc0-43cd-ac06-655d4cbf19cb/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2861019
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  458 passed | 1 skipped (459)
      Tests  3864 passed | 10 skipped (3874)
   Start at  17:27:57
   Duration  670.04s (tests 95%, transform 3%, import 2%)

    Isolate  459 workers spawned · ~225ms startup each (spawn + environment, per file)
             at least ~25.54s faster with isolate: false — reuses workers across files instead of one per file
exit 0

$ git status --short
(empty after capped full suite, HEAD a3781b51)
```

Npm emitted its existing `store-dir` configuration warning and install-script notices for esbuild and @parcel/watcher. The capped run also printed fixture gitdir repair lines, a cleanup of one process left by an earlier run, and experimental typecheck warnings; it nevertheless completed with exit 0 and no reported test failures. The coordinator stopped the uncapped run because its concurrency drove host load to 323 and other gates were timing out. That interrupted run is **unverified**, not a completed failure verdict. The capped rerun started and ended on clean review-only commit `a3781b51`; its full output is above. It passed: 458 files, 3,864 tests, with one file and ten tests skipped, in 670.04 s. No timing failure remained in this run. At 15:21 UTC the uncapped run had load `201.95 103.12 75.43`. Its timing failures are not findings against the wave. Observations before interruption included Codex bundle-parse and hook waits, daemon restart/idle timing, scheduler backlog duration bounds, and runner-part deadline failures. The interrupted run never produced a complete summary. All are superseded for verification by the passing capped full suite; no source changed between runs.

The verification above is at the actual checkout (install/lint/typecheck/build at `b36a5b5b`, capped suite at clean `a3781b51`), not the literal candidate SHA, so is **unverified for the exact candidate** under the reviewer rule. It is verified for those recorded clean commits; the product tree is identical to the candidate. The initial report commit changes only this review file. Probes use only ignored scratch directories inside this worktree (`node_modules/.review-00533`), synthetic store data and stub CLIs in a scratch HOME. No model or real harness session ran. No source changed.

## Verdict

**FAIL**: 4 proven blockers, 1 proven nonblocking should-fix item, 1 proven nonblocking scope note. The first three blockers were committed in `a3781b51` within the requested first 15 minutes. Only a proven spec or done-when break blocks.

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

**Worker-sized fix:** qualify the sentence in both skill copies to match `queueReruns`' eligibility (ordinary, not forced, not already re-run at the same key, not slow, within cap). Test the actual exceptions in the text contract; do not change scheduler policy to fit the prose. Name the cap as eight eligible test files in one tier, not eight individual failing tests. Keep the skill copies in parity and within the size budget.

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

### B4. Proven: equal completion milliseconds invent a join and change the reuse/run counts

**Locations:** `src/cli/run.ts:279` to `:286` (005-21), consuming the guessed owner at `:178`; test gap `test/cli/run-all-verdict.test.ts:296` and `:329`.

**Contract:** goal 1 requires the first line to state how many files the checkpoint reused and ran. D1 takes a joined checkpoint's work only for a request that joined it. 005-33 specifically asks whether S2 picks the right checkpoint when two end at once. Vision requires trustworthy provenance.

**Smallest proof:** a stub daemon serving the real CLI, with real `Checkpoints`, a fixed millisecond clock (`1234`), and one current listed file. Before the CLI request, `start(owner, baseline, [a])` publishes the open owner. When the stub receives `run-all`, call `finish("completed")` for the owner, then `start(request, run-all, [])`. **Never call `join()`**. Both real records complete at `1234`; the new empty request is independent and should say one already current, zero run now.

```text
no join() calls; real Checkpoints.finish/start clock=1234; exit=0
Checkpoint request completed at revision 1: no known failures; 1 test file, 0 already current, 1 run by the baseline checkpoint owner it joined
Checkpoint request started at revision 1: 0 test files to run, 1 already current, joining the baseline checkpoint owner already running them; both had ended when this command read them
owner completedAt=1234 request completedAt=1234
```

Only generated checkpoint suffixes are shortened above. The socket lived inside this worktree's scratch root through a `/proc/self/fd` path alias to satisfy the Unix socket path-length limit.

`joinedCheckpoint` equates equal `end` and `completedAt` with a join. Completion within one wall-clock millisecond is not a relationship. The verdict and exit code remain correct, but the required reuse/run counts and claimed provenance are wrong, hence blocking under goal 1. The new joined test seeds matching timestamps directly; the new non-join test avoids the bug by ending the owner 1,000 ms later. Neither distinguishes a real join from this collision.

**Worker-sized fix:** carry an explicit owner ID from the actual `Checkpoints.join()` decision to the CLI (persisted with the request or returned consistently by `run-all` and `run-all-status`). Count an owner's work only with that evidence. Clear the core/daemon interface change with 001's owner. Add paired tests using the real checkpoint tracker: a real completed-before-read join, and an independent empty request completed in the same millisecond. Keep exit codes unchanged.

## Should-fix

### S1. Proven, nonblocking: the skill's status examples still show the old combined counts

**Locations:** both `skills/squeal/SKILL.md:22`; both `skills/squeal/references/commands.md:12` and `references/reports.md:23`.

D6 says the checkpoint/status units follow D1. The main skill still shows `40 current, 3 pending` without parts; `commands.md` shows `Affected checks: 47 passed, 3 running, 12 queued`. These examples no longer match the wave's primary status output. The literals were present before this wave, so this is an integration follow-up, not another blocker against unchanged text. Update them alongside B1 to show the split, including the inherited example, and keep both harness copies in parity.

## Nits and scope notes

### N1. Proven, nonblocking: checkout HEAD differs from the build candidate

`git rev-parse HEAD` was `b36a5b5b`, not `2247281c`. The intervening files are only `docs/board.md` and 001's review documents. Report this provenance difference; do not repair board/status or include 001/006 changes in the fix wave. No product mismatch was found.

## What fits

- Main current/pending/stale/unknown counts use `fileLevelCounts`; status outcome/phase counts have the same split through the shared formatter. The mixed-count probe proves the primary current/pass line sums correctly.
- Registration's nonzero `Known failures` uses the actual check identities via `failureCountText`, rather than guessing the unit.
- The setup skill has identical copies, reads the JSON plan, prints questions without a terminal, and explicitly ends a session that cannot ask before apply. No model-based compliance claim is made.
- `--slow none` represents the all-not-slow answer, and is exclusive with positive slow/input answers. The remaining missing empty choice is harness selection (B3).
- Build completed without tracked bundle drift. The committed Codex setup directory exists under the plugin root's standard `skills/` directory and survives the build despite being outside its copy list. No real harness discovery session was run.
- The setup skills are byte-identical at 3,912 characters. The Squeal skills have matching content and references after removing the pre-existing Codex-only CLI note; that deliberate build addition is their sole diff, not a new parity defect.
- A 1,000-entry mixed test/file failure delta rendered at 9,839 characters. Primer probes for Vitest only, Vitest plus two node:test projects/slow files, and node:test only/slow files stayed at 809 to 1,425 characters for normal commands; a 4,028-character CLI command fell back to shorter command naming and stayed at 834 to 1,297. Each retained the revision definition exactly once, configured coverage names in this matrix, and the complete not-covered sentence. Combined registration/primer stayed under 10,000.
- Real setup without a terminal exited 1, printed harness questions, and left `git status --porcelain` unchanged. This verifies the command's refusal; it does not claim model compliance.

## Inputs for the fix/next wave

1. Counts worker: preserve `readHeader`/snapshot's same-revision store read and add the inherited split at that boundary. Formatting should consume exact check identities when it has them. Do not infer file counts from paths or drop the combined total. Keep the 10,000-character delivery cap.
2. Text worker: change only the new re-run wording and its parity/size tests. `queueReruns(context, ledger, failures)` is the source of truth; forced and already-re-run keys are excluded before the cap is applied. No scheduler-policy change is requested.
3. Setup worker: parser must distinguish unanswered (`null`) from declined-all (`[]`); run `setup --plan --json`, interview, then apply with an explicit flag for every answer. Gates remain applied before blocks; `--no-warmup` remains on the apply command when the skill handles warm-up separately. Never stage/commit during setup.
4. Join worker: timestamps cannot identify an owner. Only `Checkpoints.join()` establishes the relationship; return or persist that owner through the daemon/CLI boundary, including when the owner finishes before the CLI reads. Pair the true-join probe with the no-join collision probe; clear any additive core type change with 001.
5. Next proof wave owns real harness sessions. This review runs none. Confirm noninteractive no-write behavior there; preserve the stated 1,500-character primer and skill size budgets.
