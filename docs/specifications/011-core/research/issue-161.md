# Issue 161: newly committed Vitest test and reader selection

Recommend keeping the missing-inventory report open until the original runner
configuration and discovery state are captured.

**Verdict:** not reproduced for an included test in two live isolated cases on
installed **Squeal 0.1.414**, **Vitest 5.0.3**, **Node 24.22.1**. A deliberately
excluded test reproduces the reader-only output, as expected. That control does
not establish the reported defect or its cause. Research ran on 2026-11-07 within
the 20-minute bound; no product, spec, board, skill or existing hold changed.

## Questions answered

| Question | Answer and evidence |
| --- | --- |
| 1. Does a newly added included test stay `not-run`? | No in these probes. The first query selected its own file, already listed and pending, then it passed. **verified by experiment; 0.1.414 / Vitest 5.0.3**. |
| 2. Does committing it change or lose discovery? | No. Own-file selection and current pass survived commit and a further 32-second wait in both included cases. **verified by experiment; 0.1.414 / Vitest 5.0.3**. |
| 3. Can named status select a reader without giving the named test's own verdict? | Yes. With explicit Vitest exclusion, it selected the passing reader but returned exit 3, `none/not-run`, before and after commit. **verified by experiment; 0.1.414 / Vitest 5.0.3**. |
| 4. Is this the same as #142 pending discovery? | Not necessarily. #142's prior synthetic case had an unrefined revision. Our excluded control had `revision = refinedRevision = 1`, `runnerPartPending: false`, and `unlisted: false`. **verified by experiment; 0.1.414**, compared with the **read in official docs; issue-142.md at d3f36305**, which reports 0.1.390 synthetic evidence. |
| 5. What caused the original included file to remain absent? | **Not determined, because** its store, discovery trace and resolved runner configuration were not supplied, and GitHub returned 404 for its named commit. The reported 0.1.410 result is not a local reproduction. |

## Method and measured results

**verified by experiment; 0.1.414 / Vitest 5.0.3.** Initial host load was
15.73 on 24 CPUs. Each probe checked again before creating a fixture: 17.74
(idle), 17.58 (active reader), and 16.62 (excluded control), all below 24.
The installed launcher reported `0.1.414`; the tested installed CLI SHA-256 was
`c44681839af3b88b9056327d1837c4bc7407c7e4b876d756991407cedfbba596`.

The fixture used a named `server` project, `include: ['src/**/*.test.ts']`, one
worker, lookup-only baseline and runtime read observation. It contained one reader
and one newly created test. The reader read the new test's bytes with `fs`; it did
not import and execute that test. Each run used a fresh nested Git repository
under the assigned probe directory and stopped only its owned daemon (exit 0).

| Observation | Own test | Reader | CLI elapsed / exit |
| --- | --- | --- | --- |
| Idle, first query after add, revision 1 | `test-file`, pending, discovery complete | Not selected | 473 ms / 3 |
| Idle, uncommitted wait | Own current pass | Not selected | 457 ms / 0 |
| Idle, committed wait | Own current pass | Not selected | 449 ms / 0 |
| Idle, after 32 seconds | Own current pass | Not selected | 460 ms / 0 |
| Add after reader enters its gate, revision 2 | `test-file`, pending, discovery complete | Not selected | 455 ms / 3 |
| Commit before releasing reader gate | Own current pass | Not selected | 450 ms / 0 |
| Active-reader case, after 32 seconds | Own current pass | Not selected | 420 ms / 0 |
| Excluded control, committed wait | `not-run`, no own verdict | Selected, current pass | 500 ms / 3 |

Separate waits on the reader returned its own current pass: 441 ms idle, 463 ms
active-reader case, 475 ms excluded control. The active-reader gate records that
a run entered before creation; it does not prove that the run remained active.
An edit can cancel it. This was not a 966-second non-cancellable runner call.

The excluded control's structured result was:

```json
{"code":3,"result":"none","reason":"not-run","paths":[{"path":"src/added.test.ts","kind":"not-run","selects":1}],"testFiles":[{"project":"server","path":"src/reader.test.ts","state":"current","verdict":"pass"}]}
```

Its text states that the reader's verdict is not the named file's own. No false
pass occurred. This demonstrates why a reader pass cannot establish discovery.

## Source findings and interpretation

**read in official docs; specifications at d3f363054fbe5d30e6e11bf8f212e1ac74d567e1.**
011 C2 makes revisions independent of runner refinement and says an unrefined
revision stays pending. C4 orders added/edited tests as edit work. C6/C9 require
honest incomplete status and preserve holds. C15 distinguishes an own test from
readers and orders `unsynced`/`unlisted` before `not-run`. A `kind: not-run` path
alone therefore does not prove completed discovery. The issue body's excerpt
has `reason: unsynced`, not a completed-listing witness.

**read in source code; checkout 0.1.414 at d3f36305.**
`src/runners/vitest/stale.ts:72` matches added/deleted paths against project test
globs and calls `clearSpecificationsCache()`. `adapter.ts:523` lists through
`globTestSpecifications()`. `src/cli/named-selection.ts:105` selects the own row
first, otherwise readers. In installed Vitest **5.0.3**,
`dist/chunks/index.DpLw24bj.js:21068`, cache clearing without a path also clears
each project's `testFilesList`. These are existing mechanisms, not proof that the
incident executed them. The three Squeal files differ from release 0.1.410 only
in imports; no conclusion about all changes between those releases follows.

**inferred; issue reports 0.1.407/0.1.410/0.1.412, read on 2026-11-07.**
Keep two hypotheses separate: discovery delayed behind a run (the comments and
#142), and an included file still absent after completed discovery (the original
report's claim). The comments describe queued discovery with a 966-second bound;
they do not prove persistent absence after that work finishes. 013 V2/V3/V7 allow
ordinary runner-part calls during a run but serialize instance recreation.

## Recommendation, limits and sources

Preserve the no-own-verdict result. Before selecting a repair, obtain the original
resolved include/exclude/project settings, Vitest version, `refinedRevision`,
`runnerPartPending`, own-file inventory and daemon trace spanning creation and
commit. This trades a broader reproduction for avoiding a diagnosis based only
on the same output from an intentional exclusion. No implementation is proposed.

Limits: two tiny included cases on a newer Squeal release; no original monorepo,
browser project, long recreation, missing watcher-event injection or restart.
The linked dependency tree produced a daemon note about two missing fixture
packages in its pnpm lock, so dependencies used package-manifest keys. No test
failed. No full suite, build or direct Vitest run was requested. All three fixture
daemons exited 0; generated fixtures were removed. The original cause remains
open, including whether exclusion, unresolved discovery, or lost inventory applies.

- [Issue and comments](https://github.com/hearsay-tools/squeal/issues/161), fetched
  with `gh issue view 161 --repo hearsay-tools/squeal --json title,body,comments,url,state,createdAt`;
  preserved as [issue.json](probes/issue-161/issue.json).
- [Probe commands, isolation and cleanup](probes/issue-161/README.md),
  [script](probes/issue-161/probe.mjs), and full captures:
  [idle](probes/issue-161/output.jsonl), [active reader](probes/issue-161/running.jsonl),
  [excluded control](probes/issue-161/excluded.jsonl).
- Original commit lookup: `gh api repos/hearsay-tools/cezarion/contents/package.json?ref=9ab2aaa82fceef46abeebfe85b128242fe89f4d3`,
  exit 1 / HTTP 404; [capture](probes/issue-161/incident-ref.txt).
- [011 C2/C4/C6/C9/C15](../spec.md), [011 amendments](../status.md),
  [013 V2/V3/V7](../../013-vitest-runner/spec.md),
  [013 amendments](../../013-vitest-runner/status.md), [#142 research](issue-142.md).
- [Squeal source at examined commit](https://github.com/hearsay-tools/squeal/tree/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1).
  Source comparison: `git diff squeal--v0.1.410 HEAD -- src/runners/vitest/stale.ts src/runners/vitest/adapter.ts src/cli/named-selection.ts`.

Verification: `node --check` on the probe, parsing all three JSONL captures, and
`git diff --check` passed. The final research-path check used
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-161.md docs/specifications/011-core/research/probes/issue-161/probe.mjs`:
exit 3, no test closure for either path. At revision 24 the worktree had zero
known failures, 1 queued test file and 529 unknown test files. This is not a
repository-suite pass; the probe results above are separate fixture evidence.
