# Issue 82: refresh and wait for selected stale test files

Use `retry <test file>` followed by `status --wait <ms> <test file>` today; Squeal 0.1.276 has no documented single invocation that both refreshes and waits only for that selection.

Researcher, 2026-10-23. Scope: [hearsay-tools/squeal#82](https://github.com/hearsay-tools/squeal/issues/82). Source commit: `ed9c18b644816064a2d98a4bcb9a8edc1b34d77e`. Package, committed CLI bundle and installed launcher all report **0.1.276**. The issue does not name its incident's Squeal version.

## Verdict and evidence limits

**Live reproduction skipped because load exceeded the CPU count.** The first check gave one-minute load **16.29**, five-minute **21.75**, fifteen-minute **27.77**, on **24 CPUs**. A second read gave **22.10**. The probe's final guard, before creating any fixture or starting any daemon, gave **30.35986328125 / 24** and stopped. No load polling or later retry was used. The task completed within its 20-minute bound.

The two-command requirement is **read in source code, 0.1.276**. The absence of the two likely combined forms is **verified by experiment, 0.1.276**, through CLI argument checks that run no tests. The full inherited-pass-to-stale sequence is **not verified by experiment in this task**. A prepared three-file fixture remains unexecuted. The original user worktree was not accessed, and the cause of its key change was not investigated.

## Questions answered

| Question | Answer | Evidence source |
|---|---|---|
| Does a stale inherited pass with nothing queued need execution before a named wait can give a current verdict? | Yes. For an exact listed test path, `retry` requests that execution; a named wait alone cannot create it. This assumes no other worktree supplies a result at the current key in the meantime. | read in source code, 0.1.276 |
| Does one existing documented command refresh and wait only for those files? | No. `retry` selects files but cannot wait. `run --all --wait` refreshes all missing results; `--fast` and `--slow` select lanes, not paths. `warmup` is also repository-wide. | read in official docs and read in source code, 0.1.276; parser refusals verified by experiment |
| Does inheritance require a different retry route? | No origin test exists in the no-current-result branch. A current inherited pass stands at once; after its key changes, an older pass cannot provide a current verdict. | read in source code (`retry.ts:171–215`) and read in official docs (011 C5), 0.1.276 |
| Is the whole state reproduced here? | Not determined by a live run, because the load guard stopped before fixture creation. Issue 38 records the stale/wait/retry sequence on 0.1.222, but not this two-worktree inherited-pass fixture. | read in official docs (repository research record); verified by experiment for the load guard only |

## Findings

1. **A named wait changes queue order, not membership** [read in official docs; read in source code, 0.1.276]. Spec 011 C15 says: “It changes only the order in which queued files are taken. It does not change which files run.” Spec 005 D2 restricts the wait to the selected files. In `src/cli/status-wait-paths.ts:237`, a listed selection with no pending files is `settled`; `namedCode` at line 445 uses `verdictCode`. In `src/cli/verdict.ts:122`, any noncurrent selected file gives exit 3. Thus a stale selection with no queued work can settle without spending the 60-second deadline. Bootstrap preserves lookup-only: `src/core/scheduler/bootstrap.ts:202–235` abandons the baseline checkpoint and leaves misses unqueued unless predecessor work or resumed-rest rules apply. This explains the requested state, not the incident's input-key change.

2. **The existing narrow execution path is `retry`, then a named wait** [read in source code, 0.1.276]. `src/cli/retry.ts:171–215` asks for one run when the listed file has no current result, with no required reason and no spent failure retry. It joins pending work instead of duplicating it. `src/core/retry/records.ts:156` stores that request at the file's current key. `retry.ts:247` prints the next command, `squeal status --wait 60000 <file>`. This is a request followed by a wait, not a single Squeal invocation. For several files, give the same exact test paths to both commands. These are the recommended commands, **not successful live output from this task**:

   ```sh
   squeal retry tests/selected.test.mjs
   squeal status --wait 60000 tests/selected.test.mjs
   ```

3. **There is no documented combined selected-file command** [verified by experiment for parser behavior; read in source code and official docs for command scope, 0.1.276]. The committed CLI returned:

   ```text
   $ squeal retry tests/selected.test.mjs --wait 60000
   squeal retry: unknown option "--wait"
   [exit 2]
   $ squeal run --all --wait 60000 tests/selected.test.mjs
   squeal run: unknown argument "tests/selected.test.mjs"
   [exit 2]
   ```

   `src/cli/retry.ts:120–141` rejects unknown flags. `src/cli/run.ts:83–103` rejects positional paths. Help in `src/cli/main.ts:94–117` and the plugin's `references/commands.md` describes broad checkpoints and a separate retry. A shell line joining retry and status with `&&` can compose the two, but is still two invocations. The accepted focused-check design in 011 C15 (`--check`, row 011-135) is not implemented in this version's CLI and defines partial evidence, not a current result for the whole file.

4. **Issue 38's next-step wording is now present, but it does not combine commands** [read in official docs for the old experiment; read in source code, 0.1.276, for the change]. `research/issue-38.md` records 0.1.222 returning exit 3 with no command, then retry and a passing named wait. Current `src/core/status/next-step.ts:124–131` emits `last passed at other inputs, nothing queued it (the baseline is lookup-only)` with a retry step. This matches issue 82's stale-state wording. The newer requirement is one refresh-and-wait invocation. Duplicate triage remains the parent's task.

5. **Lookup-only and holds remain constraints** [read in official docs and read in source code, 0.1.276]. C10 retains lookup-only as a policy. The 2026-10-20 amendment in `status.md` preserves unqueued misses while allowing predecessor work. C15 preserves claims, slow-tier eligibility and listing barriers. The scheduler's `#onHold` (`src/core/scheduler/scheduler.ts:523`) combines merge and command holds. No recommendation here changes those rules or calls `start` to bypass an existing hold. No existing hold, policy or daemon was changed by this task.

## Exact checks and retained artifacts

Commands were run from the assigned Squeal worktree:

```sh
gh issue view 82 --repo hearsay-tools/squeal --json number,title,body,comments,url
getconf _NPROCESSORS_ONLN
cat /proc/loadavg
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
python3 docs/specifications/011-core/research/probes/issue-82/probe.py "$PWD/plugins/claude-code/dist/cli/squeal.mjs"
```

The final command produced only:

```text
Start: load=30.35986328125, CPUs=24
Skipped: load exceeds CPU count
```

It exited 1 because the probe skipped, not because a test failed. [verified by experiment]

The separate CLI checks used `node --disable-warning=ExperimentalWarning plugins/claude-code/dist/cli/squeal.mjs`, followed by `--version`, `retry --help`, `run --help`, and the two rejected forms above. Full output: [cli-output.txt](probes/issue-82/cli-output.txt). Load guard output: [output.txt](probes/issue-82/output.txt). The [probe and README](probes/issue-82/README.md) retain the intended isolated reproduction. Python syntax and `git diff --check` were checked. No full repository suite, build, bundle update or original incident test ran.

## Recommendation and open question

Treat the single-invocation requirement as an unfilled command-surface requirement, while keeping the two-command route as today's workaround [inferred from findings 1–4, 0.1.276]. Keep lookup-only, holds and result provenance unchanged. The remaining empirical question is whether the prepared two-worktree node:test fixture gives the expected inheritance and selection boundaries on 0.1.276; this run cannot answer it because load prevented execution. No incident-cause question is opened.

Sources read: issue 82 via `gh`; `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, board context; 011 C5/C6/C10/C15 and amendment log; 005 D2 and amendment log; `research/issue-38.md`; the source paths cited above; `plugins/claude-code/skills/squeal/references/commands.md`. All current repository sources are at the commit named above.
