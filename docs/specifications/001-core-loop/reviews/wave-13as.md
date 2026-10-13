# Wave 13as: 001-292 uncovered-edit delivery

## Verdict

**FAIL 04d8adfaa511da4b648723849074b72f837166ed**. Three proven blockers, no product should-fix items, one proven checkout note, no nits. Review row 001-313; candidate range `03e2cd45..04d8adfa`.

## Verification

All checks below ran on clean candidate `04d8adfaa511da4b648723849074b72f837166ed`. Each exited 0. `git status --porcelain` was empty before checks, after build, and after the full gate.

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s

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
> squeal@0.1.137 lint
> biome check .

Checked 965 files in 483ms. No fixes applied.
[exit 0]
```

```text
$ npm run typecheck
> squeal@0.1.137 typecheck
> tsc --noEmit
[exit 0]
```

```text
$ npm run build
> squeal@0.1.137 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.137 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]
```

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/d301fd4f-0ac5-4610-8837-ab72876c33eb

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/d301fd4f-0ac5-4610-8837-ab72876c33eb/test/fixtures/scheduler/.tmp/32eb13ad-9cf9-4694-9df9-f0b345c90cc2/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/d301fd4f-0ac5-4610-8837-ab72876c33eb/test/fixtures/scheduler/.tmp/bfa48ded-96ac-4ba0-abc6-5b9d64dd14d6/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 2114142

 Test Files  450 passed | 1 skipped (451)
      Tests  3793 passed | 10 skipped (3803)
   Start at  13:22:39
   Duration  596.71s (tests 97%, import 2%, transform 1%)

    Isolate  451 workers spawned · ~168ms startup each (spawn + environment, per file)
             at least ~18.76s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]
```

The initial checkout was clean at `303a5da8fa71d709689a06a0e75f672bdeebef57`, a board-only successor of the requested candidate. I detached to the exact candidate before installing and checking it, and returned to `cez/d301fd4f` only after verification to commit this file. No product files or board entries were edited. Build generated no tracked drift. No eval sessions ran. The independent Vitest command is the task's requested gate, not a Squeal checkpoint.

The three targeted probes used the candidate's freshly built modules, a real temporary SQLite store and temporary files, and `runHook` for Claude Code SessionStart/PostToolBatch/SessionEnd. They seeded scheduler-equivalent rows and supplied `ensureDaemon: async () => "alive"`; they did not start two daemons or run model evals. Their complete discriminating output:

```text
FOREIGN_CLOSURE: SQUEAL · No result for scripts/a.mjs: no test Squeal runs reads it. Run whatever tests it yourself.
FOREIGN_SUPPRESSES: ""
LOCAL_CLOSURE_CONTROL: SQUEAL · No result for scripts/a.mjs: no test Squeal runs reads it. Run whatever tests it yourself.
CAP: {"pathLengths":[3523,3523,3523],"textLength":10663,"cap":10000,"startsWith":"SQUEAL · No result for 0-"}
FIRST_TOLD: SQUEAL · No result for scripts/a.mjs: no test Squeal runs reads it. Run whatever tests it yourself.
RESUMED_WITHOUT_EDIT: SQUEAL · No result for scripts/a.mjs: no test Squeal runs reads it. Run whatever tests it yourself.
```

The probe and its temporary repositories were removed before committing. These are deterministic store/hook reproductions, not latency measurements.

## Blockers

### B1. Proven: a matching test-file identity does not make a foreign closure current for this worktree

Location: `src/core/delivery/uncovered.ts:62`, especially lines 63 to 65.

Spec goal 3: "Everything the agent is told is true at the moment it is told." The 001-292 brief requires "Read closures through this worktree's projects only" and says a covered file gets no line. D9 describes the line as naming code files that no test Squeal runs reads. D6 already states the matching trust rule: "The closure is the stored one only when this worktree wrote it or the worktree that wrote it has this worktree's current key for the test file; otherwise ... neither line appears."

`test_file_keys.list(worktreeId)` scopes the identities, but `test_files` stores one repository-wide, newest-wins closure for each `(project, path)`. The new code accepts that closure without checking which worktree produced it or whether it describes this worktree's inputs. This is a new consumer of that pre-existing shared contract, not a finding against the storage implementation itself.

Reproduction:

1. Worktree A lists and keys `src/math.test.ts` in project `""`. Its test imports `../scripts/a.mjs`, and its stored closure contains both paths.
2. Worktree B lists the same test identity at a different key. Its version no longer imports the script. B writes its closure containing only `src/math.test.ts`, with `updatedBy` set to B. This replaces A's shared row. That is the normal write contract of `storeClosures` in `src/core/scheduler/revision.ts:201` and `createTestFileRepo.put`.
3. A's registered consumer edits `scripts/a.mjs`. A's keyed test and its on-disk import remain unchanged.
4. A's PostToolBatch prints the `FOREIGN_CLOSURE` line above, although A's test reads the script. The warning is also saved as told permanently.

The converse suppresses the required warning: if B's closure includes a script that A's test does not read, A treats its uncovered edit as covered (`FOREIGN_SUPPRESSES`). Restoring A's local closure produces the expected warning (`LOCAL_CLOSURE_CONTROL`). The existing test at `test/harness/uncovered-edit.test.ts:113` only uses a foreign test with a different path; it does not exercise a shared identity at different keys.

Fix scope for one repair worker: extract/reuse the existing `closureFor` trust rule from `src/core/delivery/attribution.ts:101`. Accept a locally written closure or a foreign writer with the same non-null current key; when any listed closure is missing or fails that trust rule, defer the warning and leave the told set unchanged. Do not simply exclude foreign closures and then warn. Add paired two-worktree tests sharing the same test identity but different imports/keys, covering both the false warning and suppressed warning, plus a same-key inherited-closure case. This repair needs no new closure-storage scheme. Keep the measured sentence unchanged.

### B2. Proven: another session discards a departed consumer's told set, so resume tells the same path again

Location: `src/core/delivery/uncovered.ts:50`, the new use of `writeSlot` for permanent per-consumer history.

The brief requires "Once per path per consumer (session and agent)" and "A path told and then changed again stays told." D9 says "Each path is named once per consumer and never again." Existing registration semantics retain a departed session's registration and exclude the revisions while it was absent when the same session/agent returns within its expiry.

Reproduction through the hook API:

1. Session `s`, main agent, registers and is told `scripts/a.mjs` after an edit.
2. `SessionEnd` unregisters `s` and parks its registration.
3. Another session registers, edits `scripts/b.mjs` and receives its warning. The new `writeSlot` call rewrites `uncovered-told:<worktree>` keeping only consumers registered now (`slots.ts:35` to 45), so it drops `s`'s entry.
4. The same session `s` registers again before expiry. Its earlier edit is still in its resumed registration range, but its told set is gone. Its next editing-capable boundary prints the identical warning for `scripts/a.mjs`, even without another edit. The output above shows `FIRST_TOLD` and `RESUMED_WITHOUT_EDIT`.

The fault is the new history row choosing an active-consumer-only slot writer. The existing writer's cleanup semantics are appropriate for its other callers and are outside this range. The current second-agent test keeps both agents registered and misses this lifecycle.

Fix scope for one repair worker: preserve uncovered-path history for parked/resumable consumers until the same expiry as their registration, and restore or reuse it on resume. Integrate cleanup with departure/expiry or use a history writer with that lifetime; retain worktree removal cleanup. Add the exact end/other-session-write/resume sequence and assert silence for the previously told path, plus expiry cleanup. Do not globally disable `writeSlot` pruning for unrelated rows.

### B3. Proven: three valid paths can make the new line exceed the whole delivery cap

Locations: `src/harness/shared/uncovered-edit.ts:23` and `src/harness/shared/deliver.ts:76` to 79.

Brief item 5 and amended D9: "The line counts against the existing delivery cap." D6 caps messages at 10,000 characters.

The implementation limits the number of displayed paths, not their combined length. It reserves the entire new line against the delta, but the line itself is never bounded. With no delta it directly returns `SQUEAL · ${line}`. With a delta, a line longer than the cap also supplies a negative rendering budget.

Reproduction: create three actual `.mjs` files with relative paths of 3,523 characters each. Each path consists of 18 directories named `${i}-${j}-` followed by 190 `d` characters, then `/a.mjs`. Every component is below Linux's 255-byte limit and each absolute fixture path is below its path limit. Append one watch revision containing those three paths and call PostToolBatch after registration. The hook delivers 10,663 characters. The existing cap test only adds a short `scripts/a.mjs` line to many failures.

Fix scope for one repair worker: budget the line, including the standalone `SQUEAL · ` prefix, before reserving delta space. Fit the displayed paths and overflow count within that budget, preserving the measured wording for ordinary paths and a non-negative delta budget. Exercise long real paths with no delta and with failures. Do not silently mark an omitted path individually delivered unless the chosen overflow representation still accounts for it; keep complete failure retrieval available through the normal status pointer. Any exceptional path abbreviation should be explicit and documented rather than changing the ordinary measured sentence.

## Should-fix / notes

### N1. Proven, non-blocking: the initial checkout did not equal the requested candidate

Location: initial checkout HEAD; the successor changes only `docs/board.md:408` onward; initial `git rev-parse HEAD` was `303a5da8fa71d709689a06a0e75f672bdeebef57`, not `04d8adfaa511da4b648723849074b72f837166ed`.

This is a dispatch/checkout mismatch, not a product break. `git diff --stat 04d8adfa..303a5da8` showed only `docs/board.md`, 6 insertions and 4 deletions. Verification was performed on the clean exact candidate, so it is verified rather than evidence from the successor. Coordinator action: pin future reviewer worktrees to the requested candidate. No board repair was performed.

No other should-fix findings. No nits. Timing at D9's 80 ms p95 budget was not measured, and is unverified rather than a finding.

## What fits

- The measured sentence, singular/plural choice, first three paths and ` and N more` match the brief for ordinary paths.
- The code filter retains the prototype pattern, excludes `dist/` at every depth, checks on-disk existence, excludes listed tests and covered paths, and delays warnings while a listed closure is absent. Within one continuous registration a told path remains suppressed after further edits or subsequent coverage changes.
- Shared `deliver` reaches both Claude Code and Codex. Existing not-validated delivery takes priority and does not consume uncovered-path history. The hooks use the same store transaction and policy interfaces as implemented; no argument-order seam was found.
- `delivery.uncoveredEdits` is a boolean in `Policy`, defaults to true, is recognized by `SHAPE`, and appears in D11 and both plugins' policy references. False returns before history is written. Loader tests cover false and invalid type; default-policy tests carry the new field.
- `uncoveredTold` is registered in `WORKTREE_META_ROWS`, and the removal test exercises its cleanup.
- D9 and D11 were amended; the primer stayed unchanged as requested. Both committed plugin distributions rebuild cleanly at 0.1.137. Key format stays at the already-unreleased 9 with its updated guard pin; no extra version bump was introduced by this row.
- The new tests cover the brief's ordinary-path examples, both agents while active, off policy, daemon-down precedence, cleanup and a delta filled with failures. They do not cover B1's shared identity, B2's departed/resumed consumer or B3's path-length budget.

## Inputs for the fix wave

Dispatch three disjoint repair rows if useful: B1 owns the coverage reader and extraction/reuse of closure trust; B2 owns history lifecycle and its resume/expiry tests; B3 owns line formatting, shared delivery budgeting and cap tests. B1 and B2 both touch `uncovered.ts`, so assign disjoint sections or land them sequentially. Add independent regression tests rather than having all rows edit the existing harness test file.

Keep the shared call order: ensure daemon, register when needed, consume the delta, choose not-validated before uncovered, compute a bounded line, reserve its full serialized text budget, then render the delta. Coverage and told-history updates need short transactions; no filesystem discovery of project tests in a hook. Keep default-on/off-switch semantics, worktree cleanup, consumer isolation, the normal measured sentence, and the 10,000-character total cap. No new CLI or policy API is needed.

The functional gaps are precisely B1 to B3. A repair should re-run these three probes as regression tests, then the repository checks with the same independent full-suite gate. Review acceptance does not require new model evals; the existing 2026-10-13 results are inputs, not evidence that these storage/lifecycle/formatting cases work.
