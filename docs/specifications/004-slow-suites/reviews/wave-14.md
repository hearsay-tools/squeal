PASS bad0673d1c581765d0642902cf77a7b3991a411a

# Wave 14 review: an agent knows it can wait for slow files

Counts: 0 blockers, 0 should-fix, 0 nits. Candidate `cand/0.1.222`, row 004-83; range `origin/main..bad0673d`, merge base `36acabe3cc2956ea5a37d797751b6e5d448063bb` (0.1.221). Reviewed against `tasks/wave-14.md`, the 2026-10-19 amendment to D8/004-71, D9 and the worker's `tasks/004-83/notes.md`.

## Verification output

All required checks ran at the exact candidate on a clean tracked and untracked tree. HEAD and the clean tree were checked again after the independent run, before this review file was written. The independent suite took the host's full-run lock; it was not Squeal's checkpoint.

```text
$ git rev-parse HEAD
bad0673d1c581765d0642902cf77a7b3991a411a
$ git status --short
(no output)

$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 196 packages, and audited 197 packages in 8s

32 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   msgpackr-extract@3.0.4 (install: node-gyp-build-optional-packages)
npm warn install-scripts   opencode-ai@1.18.35 (postinstall: node ./postinstall.mjs)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
(exit 0)

$ npm run lint
> squeal@0.1.222 lint
> biome check .

Checked 1457 files in 653ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.222 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/cd2b696f-d8b9-4343-b907-826dc9c5e55c

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/cd2b696f-d8b9-4343-b907-826dc9c5e55c/test/fixtures/scheduler/.tmp/eadbe368-87e4-464c-8074-bd45f9c3eced/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/cd2b696f-d8b9-4343-b907-826dc9c5e55c/test/fixtures/scheduler/.tmp/4d2f6602-f967-4ae8-a78f-d628df06cf87/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 552906
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  733 passed | 1 skipped (734)
      Tests  6297 passed | 10 skipped (6307)
   Start at  14:26:08
   Duration  937.72s (tests 98%, import 2%)

    Isolate  734 workers spawned · ~143ms startup each (spawn + environment, per file)
             at least ~26.12s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)

$ git status --short
(no output)
```

The independent verdict is 733 files passed and 1 skipped, 6,297 tests passed and 10 skipped, in 937.72 s. This is one fewer passed test and one more skipped test than the coordinator's reported gate, not an identical coverage claim. No independent test failed and no rerun was needed. Fixture repair, an earlier-run process cleanup and Vitest's experimental type-testing notices above did not fail the run. Sampled one-minute host load ranged from 11.70 to 31.36 on 24 CPUs while it ran.

`npm run build` and model eval runs were explicitly excluded by the review brief. The build is **unverified by this reviewer**, not a finding. No setup/install/experiment was run against the real HOME. The external probes below imported the candidate's source, used private temporary fixtures, exited 0 and left the candidate clean.

Separately, the installed 0.1.199 Squeal daemon reported three failures at revision 0: OpenCode's held-Stop timing test (`test/harness/opencode-dispose.test.ts`, killed at +2037 ms and then +2220 ms against its +2000 ms idle deadline), and the recorder-signature tests in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Their `why` reports were read. All three files passed the independent run above. These background observations are recorded separately; they are not substituted for that verdict or attributed to this wave without evidence.

## Blockers

None.

## Should-fix

None.

## Nits

None.

## What fits

### The explicit wait joins the existing work

`queueSlowSuite` (`src/core/scheduler/slow-tier.ts`) counts files already queued or running and settles only misses without a phase. `SlowTier.request()` preempts the load-guard wait, not a running test. That positive count reaches `runSlowCommand`'s `holdSlow` argument. `pendingSlow` takes the initial pending slow files, and `heldSlowLeft` keeps a file whose row or checks remain pending. Finishing one file does not discharge another.

The new `test/scheduler/slow-request-join.test.ts` exercises a real scheduler/adapter, holds a continuous slow run, requests the slow suite, observes its held file, releases it, and checks exactly one run and current checks. It was green without a mechanism change; forcing a product fix or a red test for already-correct behavior is unnecessary. The worker records its count mutation's negative control. The existing CLI tests cover request-to-wait handoff, pending files, timeouts and early news.

The review also ran a standalone `node --import tsx` probe outside the checkout against the real CLI, a private store and a stand-in daemon socket. At revision 4 it seeded one running slow file and a second queued slow file, let the first finish after the wait's sync, then the second, without a check transition. Under both `slow.trigger` values and both policies, `main(["run", "--slow", "--wait", "10000"])` returned 0 only after both had finished, with `the 2 slow files run --slow queued have their results`. Before running them, `status --json` returned the two `slowPending.files` paths. No candidate file was edited; the fixture stores, sockets and probe were removed.

```text
{"trigger":"continuous","requireSlowSuite":false,"code":0,"firstDone":true,"secondDone":true,"jsonPaths":2}
{"trigger":"continuous","requireSlowSuite":true,"code":0,"firstDone":true,"secondDone":true,"jsonPaths":2}
{"trigger":"idle","requireSlowSuite":false,"code":0,"firstDone":true,"secondDone":true,"jsonPaths":2}
{"trigger":"idle","requireSlowSuite":true,"code":0,"firstDone":true,"secondDone":true,"jsonPaths":2}
```

Scope clarification from the coordinator during review, 2026-10-19: return-on-news stays. Without news every requested non-current slow file holds the wait; a slow failure still returns at once with the remainder named. The existing `run-slow-wait.test.ts` explicitly covers two held files, the first failing and the second still pending. The final verdict names that pending path; the same response's `Affected checks` and `Slow tier:` lines name how to continue waiting. The coordinator confirmed that the command need not be repeated on the news verdict itself. This is not a missing completion guarantee or a blocker.

### Texts explain the wait without changing policy

The quiet policy-off line, idle named-path wait's pause note, slow-tier ending and new affected-checks clause name `run --slow --wait 60000` as a wait for results. Singular/plural refers to the number not current. Policy-on quiet and pause text retain the specified `runs and waits` wording, including `which this wait does not hold for`. Formatter/CLI tests and the real-formatter parser matrix cover both policies and trigger values. Plain `status --wait` remains non-blocking for slow files under either policy, and no Stop implementation changed.

The primer's `wait with` / `or wait for them with` is acceptable: both describe a wait and name its command. Shortening idle's timing to `between your turns` preserves the meaning while fitting the 1,500-character cap. The tests retain the named Codex CLI at 217 and 230 characters under both policies, and the existing fallback to the CLI named in SQUEAL messages beyond the fold's reach. The common skill references match the new wording and explicitly explain joining a running file.

### Headline paths and JSON use the same pending state

`SlowPendingCounts.files` is additive and optional. `readHeader` deduplicates the same pending slow files it already counts, orders by path then project, and names at most three. It handles checks and queued/running files without checks. `slowAffectedText` names a project's file with its project and counts the remainder; no clause appears with zero slow files pending. `formatStatus` preserves the existing counts before appending the slow clause. `buildSnapshot` retains the header field in JSON; the standalone CLI probe checked its serialized paths. No stale or merely unrun file is newly described as running or queued.

`header.ts` and the `state/index.ts` exports are justified additions beyond the brief's initial file list: they supply and share the headline's paths and text. The worker notes disclose them and the other text-pin updates.

### Parsers retain evidence and recognize the new claim text

The new round-trip tests call the real status, quiet-wait, registration and news formatters, under both policies and triggers, as plain text and hook JSON. They preserve revision, pending checks and slow files not current. The old 0.1.215-0.1.221 endings remain readable. `squeal-text.mjs` reads running/queued counts before the appended clause and slow currency from `Slow tier:`; the new wait wording does not look like an unsettled slow state.

A separate real-`formatStatus` probe also called `statedSlowCount` in `slow-claim.mjs`. Copying the old headline states no slow-file count (`null`); copying the new `among them 1 slow test file` states 1. This is an intended new count, not a pending-count regression. The headline counts pending slow files only: when another slow file is unrun, it still states 1 while `slowNotCurrent` is 2. `honestUnknown` continues to require equality with the latest slow-tier total, so copying only a pending subset does not satisfy that claim. No parser change is necessary.

```text
{"pending":2,"slowNotCurrent":1,"copiedHeadlineSlowCount":1,"oldHeadlineSlowCount":null}
{"pending":2,"slowNotCurrent":2,"copiedHeadlineSlowCount":1,"oldHeadlineSlowCount":null}
```

### Release bookkeeping fits the approved scope

The eight version locations and the lockfile root package carry 0.1.222. `KEY_FORMAT_VERSION` remains 13 with its guarded-source hash re-pinned, as authorized for unreleased 13. The available `squeal--v0.1.215` tag carries version 11, and there is no local `squeal--v0.1.22*` tag. The candidate includes the coordinator's bundle commit. No extra dependency, trigger, ranking, setup or Stop behavior was added by this row.

## Inputs for the next wave

No repair wave is required by this review. Keep the explicit command `run --slow --wait 60000` as the agent's optional policy-off wait and the policy-on completion step after an edit. It joins existing work, holds all initially pending requested slow files in the absence of news, returns early on news with outstanding paths in the same response, and reports no verdict on a deadline with held slow work remaining (exit 3). Plain `status --wait` remains the fast/edit wait; idle path waits still leave queued slow files for the explicit request.

The board's planned 80-cell confirmation (a2, a3, a8, a11 × Luna and Sonnet × 10) remains release follow-up. This review proves the mechanism and emitted/parsing contracts, not whether the models now choose to wait more reliably. No eval sessions were launched. The reviewer did not change the board, spec, status log or product code.
