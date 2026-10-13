# Wave 13at: second-round review of 001-292 / repair 001-314

## Verification

Candidate: `8ac9a4c456536a65ce1abf062f9d8859ec4d8687`. `git rev-parse HEAD` matched exactly. `git status --porcelain` was empty before verification, after the build and after the full independent gate. Independent checks ran on this candidate, before writing the findings file. Repair range: `65acfe0b..8ac9a4c4`.

```text
$ npm ci
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 1s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
[exit 0]
```

```text
$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.139 lint
> biome check .

Checked 974 files in 731ms. No fixes applied.
[exit 0]
```

```text
$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.139 typecheck
> tsc --noEmit
[exit 0]
```

```text
$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.139 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.139 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]
```

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/171ccb61-afeb-4476-9483-ab4ebed7a4d8

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/171ccb61-afeb-4476-9483-ab4ebed7a4d8/test/fixtures/scheduler/.tmp/e3c091f9-8391-4d17-8382-014ba72fe3b3/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/171ccb61-afeb-4476-9483-ab4ebed7a4d8/test/fixtures/scheduler/.tmp/25518955-24cd-4823-a842-f9860e9411ba/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 1139213
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  456 passed | 1 skipped (457)
      Tests  3830 passed | 10 skipped (3840)
   Start at  14:58:01
   Duration  601.98s (tests 97%, import 2%, transform 1%)

    Isolate  457 workers spawned · ~169ms startup each (spawn + environment, per file)
             at least ~19.12s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]
```

The independent Vitest command is the brief's gate, not a Squeal checkpoint. No model evals ran. Both committed plugin distributions rebuilt without tracked drift. No product code or board entries were edited.

The following independent probes used the freshly built candidate modules, temporary SQLite stores and actual temporary files. They exercised Claude Code SessionStart, PostToolBatch and SessionEnd through `runHook`, seeded scheduler-equivalent closure/key/revision/result rows, and supplied `ensureDaemon: async () => "alive"`. No real daemon or model was needed. These probes settle storage, lifecycle and formatting behavior; they are not latency measurements.

```text
FOREIGN_CLOSURE: ""; told={}
FOREIGN_SUPPRESSES: ""
LOCAL_CLOSURE_CONTROL: SQUEAL · No result for scripts/a.mjs: no test Squeal runs reads it. Run whatever tests it yourself.
SAME_KEY: warns a, covers b
MIXED_CLOSURES: deferred with told={}; warns after final closure becomes trusted
FIRST_TOLD: SQUEAL · No result for scripts/a.mjs: no test Squeal runs reads it. Run whatever tests it yourself.
RESUMED_WITHOUT_EDIT: ""; re-edit silent
EXPIRY: fresh registration warns after new edit
CAP: {"pathLengths":[3523,3523,3523],"textLength":1000,"endsInFilename":true,"counted":3}
CAP_WITH_FAILURES: {"textLength":10000,"cap":10000}
OFF_SWITCH_RESUME: policy=false; active history before resume={} and after resume=[scripts/a.mjs]; delivery silent
FORMAT_BOUNDARIES: 24600 cases; all <=1000, wording and suffix preserved
```

Probe repositories and the throwaway probe were removed before committing. The cap case uses three actual 3,523-character `.mjs` paths, with 18 directories each, each directory below the filesystem component limit. The failures case combines those paths with 200 failing checks. The formatter sweep covers 1, 2, 3, 4, 10 and 100 paths at each first-path length from 1 through 4,100, checking the cap, grammatical ending and retained filename suffix.

## Verdict

**PASS 8ac9a4c456536a65ce1abf062f9d8859ec4d8687**. Zero blockers, one proven non-blocking should-fix note, zero nits. Review row 001-315. Bounded re-review of `reviews/wave-13as.md`: B1, B2 and B3 are closed; its settled areas were not re-prosecuted. Its checkout note N1 does not recur: this worktree started at the exact requested candidate.

## Blockers

None.

## Previously blocking findings

### B1: proven fixed, foreign closures no longer pose as this worktree's coverage

Locations: `src/core/delivery/closure.ts:12`, `src/core/delivery/uncovered.ts:77`, `src/core/delivery/attribution.ts:115`.

The extraction preserves D6's existing rule: a closure is trusted if written by this worktree, or if its writer has this worktree's same non-null current key for that test file. Coverage iterates only this worktree's listed identities. If even one has no trusted closure, it returns before writing the told set.

Both original differing-key cases defer with empty history. Restoring the local closure in the previously suppressed-warning case delivers the warning without a new edit. A same-key foreign closure covers its paths and allows an unrelated path to be warned about. A second listed project with an untrusted closure defers the entire line even though the first closure is trusted; restoring the second releases the pending warning. This checks the repair's decision to defer rather than ignore the uncertain closure. No false coverage claim is emitted in the B1 scenario.

### B2: proven fixed, told-path history survives departure and another session's write

Locations: `src/core/delivery/expiry.ts:141`, `src/core/delivery/registered.ts:156`, `src/core/delivery/registered.ts:175`, `src/core/delivery/delivery.ts:288`.

Unregistration parks the told paths beside the registration before unregistering and forgetting active state, within the existing transaction. Another session's active-slot write therefore cannot erase the parked history. Register first creates the consumer and then restores the unparked paths in its registration transaction. The shared active-only slot writer remains unchanged for unrelated callers.

The original end / other-session edit and warning / same-consumer resume sequence is silent for the first path, including a subsequent re-edit. The expiry control confirms history is in the parked row, absent from the active row while away, removed from the parked row on expired resume, and not restored into active history. A new edit after the fresh registration is warned about. This matches the parked registration's existing lifetime and revision-gap rules.

### B3: proven fixed, long paths fit both the line and delivery caps

Locations: `src/harness/shared/uncovered-edit.ts:16`, `src/harness/shared/uncovered-edit.ts:45`, `src/harness/shared/deliver.ts:79`.

The line has a 1,000-character budget including the standalone `SQUEAL · ` prefix. It tries up to three full paths, then fewer full paths with every remaining path included in ` and N more`. If the first path alone is too long, an explicit `…` precedes its retained end. The singular/plural choice reflects all paths, not only those individually printed.

The original three-long-path reproduction now delivers exactly 1,000 characters, retains `/a.mjs`, counts the other two and records all three as told. With 200 failures, the complete delivery is exactly 10,000 characters. Delta space is non-negative: this formatter yields at most 991 characters without its 9-character standalone prefix, so `MESSAGE_CAP_CHARS - (line.length + 1)` leaves at least 9,008 for the delta. Short-path wording and first-three ordering are unchanged. The repair's eight regression tests cover the original probes, expiry, inherited trust and fewer-full-path formatting; the independent boundary sweep adds singular and overflow-count boundaries.

## Should-fix / notes

### S1. Proven, non-blocking: resume writes told history with the off switch false

Location: `src/core/delivery/delivery.ts:288`; `src/core/delivery/uncovered.ts:72`.

The 001-292 brief says: "With `false`, no line and no meta row is written." D11 likewise says false "writes neither the line nor its told set." The new registration-time restoration bypasses `uncoveredEditLine`'s policy guard.

Reproduction: with the default-on policy, tell session S `scripts/a.mjs`; SessionEnd parks it and removes S's active told entry. Write `delivery.uncoveredEdits: false`, then SessionStart the same consumer before expiry. Its active `uncovered-told:` entry is written again with `scripts/a.mjs`. The next editing boundary remains silent. The independent probe above confirms both the before/after row and the silent delivery.

This is a new off-switch side effect introduced by the repair. It does not issue an incorrect coverage warning or record a new path, and preserving old history is necessary if the switch later returns to true. Per the bounded re-review instruction, new findings are notes, so this does not reopen B1 to B3 or block this candidate.

One follow-up row should settle the contract: either allow restoration of already-told paths explicitly in D9/D11 and the brief, or gate active-history restoration on policy while retaining durable history for later enabled delivery and intervening departures. Add an on / departure / off / resume / on regression proving silence while off and no duplicate warning after re-enabling. The existing false-policy test starts with no history and does not discriminate this case.

The D9 80 ms p95 hook budget was not measured and remains unverified, not a finding against this wave. These probes do not measure model adoption or the existing accepted Luna false-pass rate; the task explicitly excludes evals.

## Nits

None.

## What fits

- B1 to B3 are closed with independent reproductions and regression coverage, including real filesystem-length paths and a delivery filled with failures.
- The repair's three display/trust decisions are explicit in D9: defer while any listed closure is untrusted; budget the line at 1,000 characters with its prefix; use the first path's tail after `…` only when a full first path cannot fit. These preserve ordinary measured wording and account for every path told.
- The closure reader is shared with attribution without changing that reader's trust contract. Registration, parking and restoration agree on the added optional stored `uncovered` field and the returned `Resumed.uncovered` list; absent history in older parked records resumes as an empty list.
- Both harnesses still call shared `deliver`. The not-validated line still takes precedence, and policy false still returns before uncovered-path collection. No policy or primer changes were introduced in this repair.
- Root and plugin versions advance together from 0.1.138 to 0.1.139. Rebuilding produces no committed bundle drift. The repair changes no key-producing inputs or key-format pin.

## Inputs for the next wave

No blocking repair row is needed for this re-review. S1 can be handled by one follow-up row after the coordinator decides whether restoring old history is allowed while disabled. Keep the call order: ensure daemon, register if needed, consume the delta, select the not-validated line first, collect uncovered paths only with every listed closure trusted, fit the line, reserve its length and newline, render the delta. Keep coverage and history work in short store transactions; preserve the parked registration's expiry and gaps when restoring history. `fitUncovered` is called only with a nonempty list. Its budget includes the standalone prefix, while shared delivery adds that prefix only when no delta exists.

If accepting the repair, the coordinator can mark 001-314 and 001-315 complete and record the 1,000-character / fewer-path / ellipsis choices in the status amendment log. The reviewer has not edited the board or status. Timing evidence and any later model eval remain separate work, not a prerequisite created by this review.
