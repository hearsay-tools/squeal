# Issue 155: no CRAP for functions whose named test files are current

Recommend one change in output, not in collection: give a function with no coverage judgement an explicit pending state and reason in `squeal code`, naming the loader it waits for.

Researcher, 2026-11-06, 20-minute limit. Documentation-only. **Partly reproduced on the installed 0.1.407 runtime; the original Cezarion runs were not replayed.** Examined Squeal commit `adbdeb991a915c7c66937d9e0d0845066b78b9f8` (package 0.1.407), installed Claude Code plugin CLI 0.1.407, Node v24.22.1, Vitest 5.0.3, Linux, 24 CPUs. Initial one-minute load 13.28; every daemon start and observation passed the gate (loads 12.01 to 15.84). No build, install, product suite or full suite ran. All probe daemons stopped; `pgrep -af sq-issue-155` returned nothing afterwards.

## Verdict

- **Current verdict vs coverage record.** A current passing verdict for the test file the agent names does not mean the coverage step has judged the function. D9 waits for a current record from *every* test file whose import closure holds the source, and the coverage step judges after the results land. Between those two moments, 0.1.407 prints a new function with complexity and nothing else: no `coverage` key in JSON, no `pending`, no reason. That matches the issue's "crap: null with no reason" for new functions.
- **Not a coverage gap for the three named file kinds.** Object-property arrows, `*.testkit.ts` helpers and node:test `.cjs` sources all get CRAP from Squeal's own runs in the probe, initially and after an edit.
- **Spec drift found.** Coverage is on by default since 0.1.373 (commit `a6741966c`, "fix: enable coverage by default"), but spec D1 and `status.md` still say off since 015-89. Cezarion sets no `coverage` key, so it relies on that default.

## Questions answered

| # | Question | Answer and evidence tag (0.1.407 unless named) |
|---|---|---|
| 1 | Do new object-property arrows get CRAP? | Yes, once judged: `triple` (added in an edit) gets CRAP 2 from `src/api.test.ts`. **verified by experiment** |
| 2 | Do `*.testkit.ts` helpers get CRAP? | Yes: `makeCase` and new `makeOther` get CRAP 2. **verified by experiment**. Cezarion's `test-outbound-guard.testkit.ts` is imported by `packages/cezar/vitest.setup.ts` (setupFiles). **read in source code**, cezarion `35dfc8c0e3`. Whether Squeal counts every test file of that project as a loader through the setup file is **not determined**, because no probe used a setup-file import. |
| 3 | Do node:test `.cjs` sources get CRAP? | Yes: `pick`, `fmt` and new `last` get CRAP 2 from `label.test.cjs`. **verified by experiment** |
| 4 | Can a function show no CRAP and no reason while its named test file is current? | Yes, two ways. (a) Another loader in the slow tier is queued: `status --wait` on the named files says current, the worktree says `1 of 3 test files (1 queued)`, `triple` prints `CC 2 (ternary 1), at or under` only, JSON `coverage` absent. (b) Every test file is current but the coverage step has not judged yet: at 285 ms after the read, `status` says `all 3 test files current` and no coverage wait, `triple` has no CRAP; at 2,648 ms it has CRAP 2. **verified by experiment** |
| 5 | Is coverage off in Cezarion? | No. Its `squeal.config.json` has no `coverage` key at any of 19 commits since 2026-10-22, and the probe with no key (`PROBE_COVERAGE=absent`) gives CRAP. Default `coverage.enabled: true` in `src/core/types/policy.ts:389`. **verified by experiment / read in source code** |
| 6 | Do Cezarion's `inputs` globs make a test file a loader that blocks CRAP? | No: two test files that declare the sources as `inputs` and only read their text leave CRAP unchanged. **verified by experiment** |
| 7 | Why "waits for a test file to run" for `mutants-file.cjs`, and "a test file that loads this file has no coverage record" after #129? | **Not determined**, because the original stores, loader sets and JSON were not supplied. **read in source code:** "waits for a test file to run" is any loader queued, without a result at its key, or with a stale closure key (`src/core/code/crap/loaders.ts:96-127,196-198`); "no record" is a loader whose current result has no record 36 s after it landed while the writer is idle, or a runner without records. |

## Findings

**Q1–Q3, Q5, Q6** (**verified by experiment**). One private repository, coverage on by default, three sources. Default run (`results.json`), revision 0 and revision 1 after the edit, `status --wait 60000` on both named test files returned current in 0.3 s; `squeal code` listed 5 then 8 functions, each `CRAP 2; 100% of its lines ran in 1 test file`. The coverage-absent and inputs runs gave the same lines.

**Q4 (a), slow-tier loader** (`results-slow.json`, **verified by experiment**). An extra slow-tier Vitest file `src/api.e2e.test.ts` imports `src/api.ts`. After the edit:

```text
$ squeal status --wait 60000 src/api.test.ts .github/scripts/label.test.cjs
Named test files at revision 1: no known failures; 2 test files, each with a current result, after 0.3 s. Worktree: known failures 0; not current: 1 of 3 test files (1 queued), 1 test (1 queued)
$ squeal code src/api.ts src/helper.testkit.ts .github/scripts/label.cjs
  src/api.ts:5  double  CC 2 (ternary 1), at or under; CRAP 2; 100% of its lines ran in 1 test file
  src/api.ts:6  triple  CC 2 (ternary 1), at or under
```

JSON for `triple` has no `coverage` key. `double`, judged before, keeps its last judged states, as D9's "a pending source keeps its last judged states" says. A new function has no last state, so it shows nothing. The next `squeal status` said `1 file waits for test runs, which squeal run --all makes`; `squeal code` gives no such line.

**Q4 (b), judgement lag** (`results-slow-settle.json`, **verified by experiment**, load 14.48/24). First poll 285 ms after the post-edit reads: status `Known failures: 0; all 3 test files current`, `Coverage: 0 functions over CRAP 30, 0 untested`, slow tier current, `triple` without CRAP. Second poll at 2,648 ms: `triple ... CRAP 2`. Here the gap is about 2.5 s. **inferred:** in Cezarion it can be minutes, because `server.ts`-sized sources have many loaders, the slow tier holds `packages/web/e2e/*.e2e.ts`, mapping costs about 0.37 s of worker time per test file (D8), and the bundled fallback "stops the worktree daemon" (2447-30).

**Output gap** (**read in source code**, 0.1.407). `src/cli/code-crap-reason.ts` gives a reason only for an existing `unknown` CRAP state; `src/cli/code-coverage.ts:142` omits `crap` when the function has no state. `squeal code` has no `--wait` (`squeal code --help`). So an agent cannot tell "not judged yet" from "never measured", and has no command to wait for the judgement.

**Report versions** (**read in issue / status.md**). Runs 2265-20 (2026-10-30 20:02Z), 2337-16 and 2337-18 (2026-10-31 ~10:00Z) likely predate 0.1.381, which added `crap.reason` for unknown CRAP (015-101). A bare `null` there can also be an unknown state from before 015-101. **inferred**, because the run versions were not recorded.

## Overlap

| Issue | Relation to #155 |
|---|---|
| #129 (closed, 015-101, 0.1.381) | Added reasons for **unknown** CRAP. #155's no-reason cases are a function with **no** CRAP state (pending, first seen). Not covered by #129. The 2394-19 "no coverage record" case is #129's reason working as designed; its root cause is not determined. |
| #135 | Same output gap (`crap` absent, no reason) read in source; #135 frames it after an install with 1,182 queued files. #155 shows it after an ordinary edit with every named file current. #135's fix (explicit per-function state and reason) would cover Q4. |
| #144 | Child-process coverage boundary. Gives `untested`, a judged state, not a missing CRAP. No overlap with Q1–Q4. |
| #149 | Separate-config children and fixture exclusion. Judged `untested`, not missing. No overlap. |

## Recommendation for Squeal

1. Treat #155 as a duplicate-in-part of #135's output gap: a function the coverage step has not judged gets `crap: { outcome: "pending", reason }` with the loaders it waits for (path and whether it is queued, slow tier or awaiting a record), never an absent key. Keep D9's every-loader rule; a missing record never proves a result.
2. Consider a bounded wait for `squeal code <path>`, or a `status` signal that the coverage step is behind, so "all test files current" is not read as "CRAP ready". This is a product change; existing holds stand and nothing is authorized here.
3. Fix the D1 and `status.md` record: coverage is on by default since 0.1.373. That is the coordinator's edit, not this file's.

## Open questions

- Which loader kept `mutants-file.cjs` waiting, and which loader lacked a record for `cursor-runner.ts`? Needs the original store or `squeal code --json` with loader names from a Cezarion worktree.
- Does a Vitest `setupFiles` import put the setup file's imports in every test file's closure? Decides whether the testkit case is Q4 (a) with hundreds of loaders.
- How long is the judgement lag in Cezarion at its size? Needs a measured read there, not on this host.

## Reproduction limits

Synthetic fixture with one test file per source, one slow file, tiny sources and no transforms beyond Vitest's. No tsx-loaded node:test project, no setup file, no shared store across worktrees, no daemon restart and no bundled fallback. The Cezarion comments were read, not replayed.

## Sources

- Issue: `gh issue view 155 -R hearsay-tools/squeal`; comments via `gh api repos/hearsay-tools/cezarion/issues/comments/<id>` for 6532356979, 6541965659, 6542149952, 6542306757, 6549073451, 6556765618, 6586632987.
- Cezarion config history: `gh api 'repos/hearsay-tools/cezarion/commits?path=squeal.config.json&since=2026-10-20T00:00:00Z'` and each file at its commit; `packages/cezar/vitest.config.ts` and `vitest.setup.ts` at `35dfc8c0e3e052c819e1de7a92f29752538eb00e`.
- Squeal source at `adbdeb991`: `src/core/types/policy.ts:389`, `src/core/code/crap/loaders.ts`, `src/core/code/crap/file.ts`, `src/cli/code-crap-reason.ts`, `src/cli/code-coverage.ts`, `src/core/code/coverage/runtime.ts:35-43`; `git log -L389,389:src/core/types/policy.ts`.
- Spec: `docs/specifications/015-coverage-complexity/spec.md` D1, D6, D8, D9; `status.md` lines 126, 134, 140, 219.
- Probe: [`probes/issue-155/`](probes/issue-155/README.md), outputs `results*.json`.
- Related research: `issue-129.md`, `issue-135.md`, `issue-144.md`, `issue-149.md`.
