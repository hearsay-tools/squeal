# Issue 112: temporary per-file pause

Treat fixture isolation as a Cezarion repair and a retained per-file blocked state as a separate Squeal capability request.

2026-10-27. Owner: 011 C4/C6/C9/C15; related policy: 004 D7/D8. Research only. Existing holds stand. No implementation is authorized by these findings.

## Scope and verdict

The [issue](https://github.com/hearsay-tools/squeal/issues/112) reports an extra `cez-agent-*` entry returned by Cezarion's cleanup test at revision 159. Its repository head was `f765ca0de271fb953f7ec2b03c66fb7e5b7a7221`, with uncommitted changes. The investigation launcher was Squeal 0.1.368; the daemon version at the original failure is unknown.

This probe ran Squeal **0.1.368**, Node **24.22.1**, Vitest **5.0.3**. The checkout was **0.1.369**, commit `cd8f30be44eba75a54e2e781a16f9d42c141b44a`. The CLI, hold, stop, verdict, Vitest adapter and command-hold source files cited below have no diff from tag `squeal--v0.1.368`. Initial assigned load was 14.93 on 24 CPUs; inspection measured 15.36; immediately before live work it was **11.58** (five/fifteen-minute: 14.02/13.80) on **24 CPUs**, at 22:01:40 UTC. The load gate allowed the probe.

The capability gap is reproduced: the available hold stops unrelated validation, while exclusion continues it but removes the selected file from coverage. The original shared-directory removal was deliberately not reproduced.

## Questions answered

| Question from the brief | Answer and evidence tag | Version examined |
| --- | --- | --- |
| Q1. Is this a test-isolation defect or a Squeal sandbox violation? | The test calls a production sweep that enumerates OS temporary roots. The mechanism matches a fixture boundary defect. The original deletion remains unverified; no sandbox violation is demonstrated. **read in source code** | Cezarion `f765ca0de271fb953f7ec2b03c66fb7e5b7a7221` |
| Q2. Does the CLI support a temporary per-file hold/pause? | No supported form was found. `pause <file>` and `hold --file <file> -- …` exit 2. `hold` applies to the whole worktree. **verified by experiment** | Squeal 0.1.368 |
| Q3. Can unrelated validation continue while one file is withheld? | Yes through `vitest.exclude`, but the excluded file is `not-run`, absent from listed test files and coverage counts, rather than retained as blocked. **verified by experiment** | Squeal 0.1.368 / Vitest 5.0.3 |
| Q4. Can the synthetic exclusion be reversed without a daemon restart? | Yes. Removing the exclusion and editing the safe cleanup file restored two current passing files. The synthetic outsider guard passed. **verified by experiment** | Squeal 0.1.368 / Vitest 5.0.3 |

## Findings

**Q1, read in source code, Cezarion commit above.** The crash-orphan test creates a private `dataDir`, then calls `sweepAgentTmpDirs(dataDir, ['live'])` and expects only `orphan-1` and `orphan-2`. The production function also calls `sweepFallbackRoots(dataDir, keep)`. That helper loops over `osTempRoots()`, calls `readdirSync(osRoot, …)`, and removes qualifying entries. Its foreign-owner branch is `ownerDataDirGone(…)`; its comment permits removal when the recorded owner directory no longer exists. The fetched source confirms a route beyond the test fixture. It does not prove which directory was removed in the reported dirty worktree. The original test was not run. See preserved [source excerpts](probes/issue-112/sources.txt).

**Q2, verified by experiment, Squeal 0.1.368.** With both safe files current, `hold --max 30s -- node -e <bounded-marker-child>` began a worktree hold. Editing both files then waiting on only the unrelated file exited 3 and printed `no verdict, since edits are recorded and not run`. Neither execution counter advanced. Releasing the child ended the hold; both files became current at revision 1, exit 0. Source agrees: `holdCommand` records worktree ownership without a file selector, and C9 says “no tier starts in any lane of the worktree.” `stop --until-start` is also worktree-wide. `start` ends command holds, so it is not a selective release tool. No existing hold was changed.

**Q3, verified by experiment, Squeal 0.1.368.** The probe set `vitest.exclude` to `["test/cleanup.test.js"]` in its own configuration. After the daemon reloaded it, JSON returned `selection.result: "none"`, `selection.reason: "not-run"`, and `selection.testFiles: []`. Editing both synthetic files then produced a current unrelated result at revision 3, exit 0. Only the unrelated execution counter advanced. A named cleanup wait exited 3: `No verdict: Squeal does not run test/cleanup.test.js`. The same line reported `all 1 test file current`. This is honest coverage exclusion, but it lacks the issue's retained blocked check. **read in source code, Squeal 0.1.369, unchanged from 0.1.368:** Vitest `#covered` filters excluded files before listing; its comment says they are not “listed, keyed, run or counted.” C15's `paused` reason means slow files waiting for an agent pause or `run --slow`, not a user-selected safety pause.

**Q4, verified by experiment, Squeal 0.1.368.** Removing the exclusion and editing the safe synthetic cleanup file restored both files at revision 4, exit 0. Its test enumerated only its own `owned` subdirectory, removed two synthetic orphans, and checked that an outsider beside that subdirectory still existed. This demonstrates the probe's ownership boundary, not a fix or regression test for Cezarion. Teardown stopped the fixture daemon with exit 0, observed daemon exit 0, and removed only the fixture directory.

## Recommendation and limits

**inferred, from the versions above:** keep the two responsibilities separate. Cezarion needs fixture-owned enumeration and an outsider regression guard. Squeal's existing exclusion can leave other checks running, but guidance must call that a coverage change. It cannot truthfully present it as a temporary blocked check. A retained per-file pause is a capability decision for the coordinator and human, not a documentation-only fix. The deciding tradeoff is continued feedback versus preserving visible incomplete validation.

Not determined: the original daemon version and deleted entry's ownership, the final Cezarion repair, cancellation of an already running unsafe test, indirect sweeps in setup/imports, cross-worktree pause scope, and pause expiry or authorization rules. The dirty incident state was unavailable; these behaviors were outside this bounded probe. No automatic retry of the reported cleanup was requested. No full suite, build, real Cezarion test, shared-root sweep or hard-isolation test ran.

## Commands and sources

- Read the issue: `gh issue view 112 --repo hearsay-tools/squeal --json title,body,comments,url,state`.
- Check the installed launcher: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version` and `--help`: 0.1.368; help offers a whole-worktree hold, no per-file pause.
- Run: `python3 docs/specifications/011-core/research/probes/issue-112/probe.py > docs/specifications/011-core/research/probes/issue-112/output.txt 2>&1`: **exit 0**, all assertions passed. [Probe and bounds](probes/issue-112/README.md); [exact child commands and output](probes/issue-112/output.txt). Only two synthetic test files ran.
- Research-path check: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-112.md docs/specifications/011-core/research/probes/issue-112/probe.py`: exit 3, no test closure holds either path; worktree known failures 0, five unknown files of 1,313. This is not a repository test pass. Python syntax parsed successfully; the staged diff passed `git diff --cached --check`.
- Fetch Cezarion: `gh api 'repos/hearsay-tools/cezarion/contents/packages/cezar/src/runs/agent-tmpdir.test.ts?ref=f765ca0de271fb953f7ec2b03c66fb7e5b7a7221'` and the same command with `agent-tmpdir.ts`; decode the JSON `content` field. [Test source](https://github.com/hearsay-tools/cezarion/blob/f765ca0de271fb953f7ec2b03c66fb7e5b7a7221/packages/cezar/src/runs/agent-tmpdir.test.ts#L212); [sweep source](https://github.com/hearsay-tools/cezarion/blob/f765ca0de271fb953f7ec2b03c66fb7e5b7a7221/packages/cezar/src/runs/agent-tmpdir.ts#L747).
- Squeal sources at checkout commit above: `src/cli/main.ts`, `src/cli/hold.ts:57`, `src/cli/stop.ts:38`, `src/cli/verdict.ts:134`, `src/runners/vitest/adapter.ts:750`, `src/core/scheduler/command-hold.ts:13`; contracts: [011 C9](../spec.md#c9-daemon-lifecycle), [011 C15](../spec.md#c15-named-demand), [004 D7](../../004-slow-suites/spec.md#d7-policy). Equality check: `git diff squeal--v0.1.368 HEAD -- src/cli/main.ts src/cli/hold.ts src/cli/stop.ts src/cli/verdict.ts src/runners/vitest/adapter.ts src/core/scheduler/command-hold.ts`: empty.
