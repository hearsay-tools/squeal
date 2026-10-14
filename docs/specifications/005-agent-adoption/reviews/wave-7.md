# Wave 7: narrow review of 005-47 (row 005-54)

## Verification output

Started 2026-10-14 at about 10:00 UTC. First findings file written at 10:06 UTC, within the brief's 15-minute limit. Extended with completed verification at 10:12 UTC.

Checkout: `45046b2b472153ade4de7e0e8888b08b121eaeb5`, initially clean. The brief names `970af7ba..32168eec`. `970af7ba` contains the principal repair itself, so it was inspected inclusively (`970af7ba^..32168eec`). Its integrated counterpart is `c1e8a2df`; the checkout includes that repair and the 0.1.160 bundles. `git diff --exit-code 32168eec HEAD -- src/cli/setup test/cli/setup plugins/claude-code/skills/setup plugins/codex/skills/setup test/harness/setup-skill.test.ts` exits 0.

The checks below started on clean `45046b2b`, not `32168eec`. Only this findings file was added while the suite ran; no source, tests, skills, or bundles changed. Under the reviewer skill the checks are **unverified for the exact named endpoint**, and the full-suite evidence also carries the documentation-only dirty-tree qualification; these qualifications are not blockers. The source equality above explains their relevance to 005-47.

```text
$ git rev-parse HEAD
45046b2b472153ade4de7e0e8888b08b121eaeb5
$ git status --short
[no output]
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
> squeal@0.1.160 lint
> biome check .
Checked 1001 files in 247ms. No fixes applied.
[exit 0]
$ npm run typecheck
> squeal@0.1.160 typecheck
> tsc --noEmit
[exit 0]
$ npx vitest run --maxWorkers=4
RUN v5.0.3
Test Files  470 passed | 1 skipped (471)
     Tests  3973 passed | 10 skipped (3983)
  Start at  12:01:54
  Duration  624.81s (tests 98%, import 2%)
   Isolate  471 workers spawned · ~141ms startup each (spawn + environment, per file)
            at least ~16.47s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]
```

The suite also printed two fixture `repair: gitdir incorrect` diagnostics, `squeal tests: killing 1 process(es) an earlier run left: 1335457`, and three copies of Vitest's experimental type-testing notice. None failed the run. Host one-minute load samples were 37.32, 40.65, and 11.64. There was no failing test or timeout to reproduce alone.

Exactly one full independent Vitest run completed. No Squeal checkpoint substitutes for it. Build deliberately omitted under the explicit brief. No model session or real Claude/Codex invocation was made. Cezar was read only with `git -C /home/agent/projects/cezar show 5dbb4b09:AGENTS.md`. Probes operate on throwaway instruction files and bundle only the gate scanner into a temporary file, without changing committed bundles or reading harness configuration. Each failure fixture was committed in a scratch Git repository before scanning its `git ls-files` result and writing through `rewordGates`; all four write/read-back assertions succeeded. All temporary probes were removed before committing this file.

## Verdict

**FAIL: 3 proven blockers, 1 proven should-fix note, 0 plausible findings, 0 nits.** The blockers break goal 5/D5 and the explicit 005-54 checks. All four bad inputs were offered by `scanGates`, accepted by `rewordGates`, and read back from disk. They are not concerns inferred from a regular expression alone.

## Blockers

### B1. Proven: describing a command is still offered as a gate

Location: `src/cli/setup/gates.ts:239` (`subject`, reached from `scanGates` at line 94).

Contract: goal 5, "Setup finds instruction lines that run the test command"; the brief, "No gate line that ... describes the command is reworded."

Fixture in committed `AGENTS.md`:

```markdown
The `npm test` command runs the unit suite.
```

Actual proposal and disk write:

```markdown
The `squeal run --all --wait 110000` command runs the unit suite. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

This sentence describes the npm script. It neither instructs an agent to run it nor authorizes replacing that description with a checkpoint. The candidate's guard catches only a subject that starts with the command, not "The ... command", "Our ... script", or similar prose. The corpus supplies this class directly: `docs/specifications/003-node-test-runner/tasks/003-37/notes.md:16` begins "The `node --test` parent process records too" and is offered when used as an instruction-file fixture. This is evidence about the scanner, not a finding against that notes file.

Worker-sized fix: conservatively require a recognized instruction/gate context before proposing a replacement, or refuse these descriptive prefixes. Add `scanGates` and write-path regressions for descriptive prefixes, preserving the plain imperative and historical Verification example. Report unrecognized descriptions without an edit.

### B2. Proven: negation is lost across line wrapping and abbreviations

Locations: `src/cli/setup/gates.ts:191` (`leadIn`), `:214` (`notRun`), and `:146` (line-only context in `commandLines`).

Contract: 005-54, "No gate line that is negated ... is reworded"; 005-47's outcome, "rewords only lines that tell the agent to run the test command."

Two realistic instruction-file fixtures are both proposed and written:

```markdown
Do not run the whole suite,
including `npm test`.
```

```markdown
Do not run tests manually (e.g. via `npm test`).
```

The first becomes:

```markdown
Do not run the whole suite,
including `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

The second likewise replaces the command and appends an instruction to run it as fallback. `leadIn` resets after the abbreviation's period, so it sees only "via", missing "Do not". The line-wrapped case has no preceding-line context. Neither line is a gate; the new fallback also contradicts the original prohibition. Cezar's instruction paragraphs visibly use this wrapping style. The fact that its specific line 185 has the negation on the same physical line does not prove its nearest variant safe.

Worker-sized fix: retain the command sentence's preceding physical-line context, or refuse continuation lines conservatively; do not treat abbreviation stops as sentence boundaries that discard negation. Add both fixtures to the public scanner/write-path tests. Keep "Do not commit generated files. Run `npm test` before you finish." rewordable.

### B3. Proven: an abbreviation places the fallback inside the command's sentence

Locations: `src/cli/setup/gates.ts:202` (`sentenceEnd`) and `:282` (`reword`).

Contract: 005-54, "No rewording leaves a broken sentence, and the fallback sentence follows the command's own sentence."

Input:

```markdown
Run `npm test` before finishing (e.g. after code review).
```

Actual proposal and disk write:

```markdown
Run `squeal run --all --wait 110000` before finishing (e.g. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead. after code review).
```

`sentenceEnd` treats the period in "e.g." as the end of the command sentence and inserts the fallback inside its parenthesis. The lowercase fragment after the inserted sentence proves the corruption. `unfit` uses the same recognizer, so it approves the edit rather than refusing it. This also affects a parenthetical "i.e." or prose with an abbreviation followed by a space.

Worker-sized fix: use a conservative sentence boundary that does not split abbreviations/parentheticals, or leave ambiguous lines for a human. Test scanner acceptance/refusal and exact output, including a real multi-sentence gate so the fallback still precedes "Paste the output in your final message."

## Should-fix

### S1. Proven, nonblocking: brief and checkout identify different candidates

Location: `docs/specifications/005-agent-adoption/tasks/wave-7.md:69`.

The named endpoint is `32168eec`, but HEAD is `45046b2b` with the later 0.1.160 build and brief. An exclusive `970af7ba..32168eec` also excludes the main repair stored in `970af7ba`; the integrated history uses `c1e8a2df` for that content. This is scope/provenance drift, not a product failure. Reviewed source/test/skill equality is established above. The coordinator should name the integrated repair inclusively and the release candidate explicitly in the next brief; the reviewer did not edit the board, brief, or status.

## Nits

None.

## What fits

- The exact five Cezar lines at 172, 185, 201, 237, and 326 receive no proposal. Line 185 is a mention, not a gate. Line 172 is a table-row refusal; 237 is a subject refusal. Lines 201 and 326 already name Squeal.
- The full Cezar file receives **zero** rewording proposals. Its other command lines in code fences are refused. This closes the recorded dogfooding examples.
- This repository's tracked instruction files receive **zero** proposals. Its existing Verification line is not proposed again.
- A plain `Run npm test before you finish.` remains rewordable, including when its command is in a code span. The historical Verification fixture in `test/cli/setup/fixture.ts:36` rewords exactly: lint, typecheck and build remain; the fallback follows the checkpoint sentence; "Paste the output in your final message." remains last. The throwaway probe asserted the whole result, not substrings.
- `SetupPlan.squealMentions` is populated from the same `instructions` paths used by `formatPlan`. The first Squeal-naming line outside the managed block is listed; the block itself is ignored. The default block choice intentionally stays unchanged. The skill tells the agent to show that line with the block question, matching that reported behavior.
- Both setup skill copies compare byte-for-byte equal (`cmp`, exit 0). Each is 4,454 characters, below the 5,000-character budget.
- The new tests cover the five dogfooding lines, known negation words, the historical exact gate, mentions outside a block, and skill-copy identity. They do not cover descriptive prefixes, wrapped negation, or abbreviation boundaries, which explains why the three blockers escape them.

## Inputs for the fix wave

One repair worker can own `src/cli/setup/gates.ts` and `test/cli/setup/gates.test.ts` for B1 to B3. Preserve `scanGates(root, tracked, { nodeTest })` and `rewordGates(root, tracked, ids, { nodeTest })`. Classification must run before rewording: exclude managed-block/previously-reworded lines; keep Squeal/negated/descriptive lines out of edits; refuse ambiguous sentence boundaries; only then generate the checkpoint and put its fallback after its complete sentence. Do not broaden which files setup edits. Preserve the 110,000 ms wait, other command spans, symlink deduplication, per-line choice, and all-or-nothing refusal for chosen ids. No changes to plan/format/skill seams are needed for these blockers. The next review can replay these four inputs, the historical exact example, and the five Cezar fixtures; it need not re-review settled surfaces.

## Corpus method and every proposed rewording

Snapshot taken before this findings file existed: **435 files**, consisting of tracked Markdown under `docs/`, repository role skills, both plugins' skills, plus Cezar's `5dbb4b09:AGENTS.md`. Each complete file was copied as a temporary `AGENTS.md` to exercise gate classification with its original line wrapping and fences, `nodeTest: true`. That conservative corpus mode yields **80 proposals, 369 refused gate lines, 121 mentions**. It tests what these lines would do in an instruction file; it does **not** mean setup writes arbitrary docs or plugin skills. The real tracked-path scan returns **0 gates and 2 mentions**, both in repository role skills. The actual Cezar scan returns **0 proposals**. Existing review/lessons files are corpus text only, never reviewed work or findings against those files.

Every corpus proposal follows, with its original location and complete input/output. No corpus source file was edited.

### Corpus 1: docs/specifications/001-core-loop/lessons.md:745

Input:

```markdown
- Useful: a timeout in a test of a file the agent had changed, flagged while its own `npm test` still ran; and the batch of FAIL -> PASS flips after `npm ci`, which showed the opening 65-failure baseline (inherited from other worktrees, almost all "Cannot find package" with no `node_modules`) was not the branch's.
```

Proposed:

```markdown
- Useful: a timeout in a test of a file the agent had changed, flagged while its own `squeal run --all --wait 110000` still ran; and the batch of FAIL -> PASS flips after `npm ci`, which showed the opening 65-failure baseline (inherited from other worktrees, almost all "Cannot find package" with no `node_modules`) was not the branch's. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

### Corpus 2: docs/specifications/001-core-loop/research/claude-code-integration.md:71

Input:

```markdown
  The label says "Stop hook" whatever the source event. The woken agent acted on its own: it ran `npx vitest run` and `git status` before replying.
```

Proposed:

```markdown
  The label says "Stop hook" whatever the source event. The woken agent acted on its own: it ran `squeal run --all --wait 110000` and `git status` before replying. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 3: docs/specifications/001-core-loop/research/environment-failures.md:71

Input:

```markdown
Read-only, at `5dbb4b09`. `packages/web/e2e/` holds 75 `*.e2e.ts` files, and 74 have a file-level `beforeAll`. 71 call `AgentBrowser.open`, which throws "the agent-browser provider is not installed" (`agent-browser.ts:410`). 60 read `baseUrl` from the shared test environment and fetch it. The project's `globalSetup` (`environment.ts`) throws on a missing browser and would crash the whole run instead. So in the revision-47 run the descriptor must have said "installed" at setup time, or setup passed and the provider went missing later. Not determined, because that needs the run log in the store. The project is in `slow.include`, so 001-171 never re-ran these files. cezar's `npm test` does not run this project. Row 001-349 (follow the projects the test script runs) would remove all 24 from the case without any classifier.
```

Proposed:

```markdown
Read-only, at `5dbb4b09`. `packages/web/e2e/` holds 75 `*.e2e.ts` files, and 74 have a file-level `beforeAll`. 71 call `AgentBrowser.open`, which throws "the agent-browser provider is not installed" (`agent-browser.ts:410`). 60 read `baseUrl` from the shared test environment and fetch it. The project's `globalSetup` (`environment.ts`) throws on a missing browser and would crash the whole run instead. So in the revision-47 run the descriptor must have said "installed" at setup time, or setup passed and the provider went missing later. Not determined, because that needs the run log in the store. The project is in `slow.include`, so 001-171 never re-ran these files. cezar's `squeal run --all --wait 110000` does not run this project. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead. Row 001-349 (follow the projects the test script runs) would remove all 24 from the case without any classifier.
```

### Corpus 4: docs/specifications/001-core-loop/research/probes/process-group-tests-under-squeal/README.md:12

Input:

```markdown
- `run-cases.sh <clone> <label> <n>`: runs cursor S26 to S28 `n` times with `npx vitest run`, printing the launching shell's sid, pgid and tty. Run directly for "shell", under `setsid -w` for "detached session leader".
```

Proposed:

```markdown
- `run-cases.sh <clone> <label> <n>`: runs cursor S26 to S28 `n` times with `squeal run --all --wait 110000`, printing the launching shell's sid, pgid and tty. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. Run directly for "shell", under `setsid -w` for "detached session leader".
```

### Corpus 5: docs/specifications/001-core-loop/research/probes/pull-advances-push/README.md:16

Input:

```markdown
- `race/race.probe.ts`: the store races, against this checkout's real store, state sink and delivery. Run from the repository root after `npm ci`: `npx vitest run --root docs/specifications/001-core-loop/research/probes/pull-advances-push/race --config vitest.config.ts`.
```

Proposed:

```markdown
- `race/race.probe.ts`: the store races, against this checkout's real store, state sink and delivery. Run from the repository root after `npm ci`: `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --root docs/specifications/001-core-loop/research/probes/pull-advances-push/race --config vitest.config.ts` instead.
```

### Corpus 6: docs/specifications/001-core-loop/research/process-group-tests-under-squeal.md:49

Input:

```markdown
The same escape, reproduced with a real daemon (`logs/daemon-probe-stays-current.txt`). After a bootstrap at `fece365c` with 3 known failures, only the mock was replaced. The daemon recorded revision 1 ("changed packages/cezar/scripts/mock-cursor-print.mjs") and ran nothing in 60 s. Status still read "Known failures: 3 ... observed at revision 0, current", while `npx vitest run` on that tree gave `Tests 3 passed`. *Verified by experiment.*
```

Proposed:

```markdown
The same escape, reproduced with a real daemon (`logs/daemon-probe-stays-current.txt`). After a bootstrap at `fece365c` with 3 known failures, only the mock was replaced. The daemon recorded revision 1 ("changed packages/cezar/scripts/mock-cursor-print.mjs") and ran nothing in 60 s. Status still read "Known failures: 3 ... observed at revision 0, current", while `squeal run --all --wait 110000` on that tree gave `Tests 3 passed`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. *Verified by experiment.*
```

### Corpus 7: docs/specifications/001-core-loop/research/revert-restore-pass-2.md:3

Input:

```markdown
Research task 001-343 for spec 001, 2026-10-13. The coordinator's landing gate for 001-335 (`/tmp/sq-int-335`, main 47ec9ee5 plus two scheduler-test commits, 0.1.151, `npx vitest run --maxWorkers=4`, host load about 80, 936.86 s, 1 failed of 466 files) read `[ 'current pass', 'current pass' ]` at `test/integration/revert-restore.test.ts:195`. The file passed 5 of 5 alone straight after. The gate's store is gone. Its log was not at the path the brief names; the copy at `/tmp/sq335-gate.log` (39 lines) holds only the assertion. Linux 6.8, 24 CPUs, Node 24.21.0, Vitest 5.0.3, Vite 8.3.2. Experiments ran on scratch copies of this branch outside every worktree, one with `sources.ts` as before this row (`unfixed`, 5fadbea8) and one as at 97350b49 (`fixed`). An earlier researcher on this row (cezar run 53a4ec09) found the in-flight gap and committed 9dcec7f8 and f0fafaed before its session failed on a model error. Its scratch data was deleted. The numbers this file cites from it are read from that session's log, not re-run, and are tagged so. Probes: `probes/revert-restore-pass-2/` (throwaway).
```

Proposed:

```markdown
Research task 001-343 for spec 001, 2026-10-13. The coordinator's landing gate for 001-335 (`/tmp/sq-int-335`, main 47ec9ee5 plus two scheduler-test commits, 0.1.151, `squeal run --all --wait 110000`, host load about 80, 936.86 s, 1 failed of 466 files) read `[ 'current pass', 'current pass' ]` at `test/integration/revert-restore.test.ts:195`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead. The file passed 5 of 5 alone straight after. The gate's store is gone. Its log was not at the path the brief names; the copy at `/tmp/sq335-gate.log` (39 lines) holds only the assertion. Linux 6.8, 24 CPUs, Node 24.21.0, Vitest 5.0.3, Vite 8.3.2. Experiments ran on scratch copies of this branch outside every worktree, one with `sources.ts` as before this row (`unfixed`, 5fadbea8) and one as at 97350b49 (`fixed`). An earlier researcher on this row (cezar run 53a4ec09) found the in-flight gap and committed 9dcec7f8 and f0fafaed before its session failed on a model error. Its scratch data was deleted. The numbers this file cites from it are read from that session's log, not re-run, and are tagged so. Probes: `probes/revert-restore-pass-2/` (throwaway).
```

### Corpus 8: docs/specifications/001-core-loop/reviews/wave-13an.md:52

Input:

```markdown
The first full-suite attempt (`npx vitest run`, default concurrency) terminated with SIGTERM, exit 143, before any final counts. It printed one failing case in `test/harness/hung-daemon.test.ts`: “is down past grace, unresponsive on its socket, and not replaced.” The cause of that interruption is **unverified**; the coordinator confirmed it did not send a signal during this review. Load rose above 55 on this 24-CPU host. The interrupted run is not a complete proof and is not a finding against this wave. The completed attempt in the verification block limits concurrency to four workers, as the coordinator requested after the interruption. The completed full run passes, including `hung-daemon.test.ts` and the candidate's original boundary regressions. It printed fixture gitdir repair diagnostics and swept one process from an earlier dead test run, without failing teardown. No ENOSPC was reported. At the coordinator's request, the earlier SIGSTOP timing failure was also checked alone, on the same clean candidate:
```

Proposed:

```markdown
The first full-suite attempt (`squeal run --all --wait 110000`, default concurrency) terminated with SIGTERM, exit 143, before any final counts. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. It printed one failing case in `test/harness/hung-daemon.test.ts`: “is down past grace, unresponsive on its socket, and not replaced.” The cause of that interruption is **unverified**; the coordinator confirmed it did not send a signal during this review. Load rose above 55 on this 24-CPU host. The interrupted run is not a complete proof and is not a finding against this wave. The completed attempt in the verification block limits concurrency to four workers, as the coordinator requested after the interruption. The completed full run passes, including `hung-daemon.test.ts` and the candidate's original boundary regressions. It printed fixture gitdir repair diagnostics and swept one process from an earlier dead test run, without failing teardown. No ENOSPC was reported. At the coordinator's request, the earlier SIGSTOP timing failure was also checked alone, on the same clean candidate:
```

### Corpus 9: docs/specifications/001-core-loop/reviews/wave-13bc.md:117

Input:

```markdown
- Unchanged stress schedule, as required by 001-326: `npx vitest run test/harness/stop-slow-untold.test.ts --maxWorkers=4 -t "13an S2: a pending file moved and failed at a newer key before its first read blocks"`, 20 consecutive independent runs beside the full suite. Each exited 0 with `Test Files  1 passed (1)` and `Tests  2 passed | 38 skipped (40)`, one pass per harness. Sampled one-minute load was 36.09 to 50.41.
```

Proposed:

```markdown
- Unchanged stress schedule, as required by 001-326: `squeal run --all --wait 110000`, 20 consecutive independent runs beside the full suite. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/harness/stop-slow-untold.test.ts --maxWorkers=4 -t "13an S2: a pending file moved and failed at a newer key before its first read blocks"` instead. Each exited 0 with `Test Files  1 passed (1)` and `Tests  2 passed | 38 skipped (40)`, one pass per harness. Sampled one-minute load was 36.09 to 50.41.
```

### Corpus 10: docs/specifications/001-core-loop/reviews/wave-13bc.md:118

Input:

```markdown
- Current candidate, the new handoff test, existing read-boundary/untold schedules and key-format guard: `npx vitest run test/keys/key-format.test.ts test/harness/stop-slow-handoff.test.ts test/harness/stop-slow-boundary.test.ts test/harness/stop-slow-untold.test.ts --maxWorkers=4`. Exit 0, `Test Files 4 passed (4)`, `Tests 91 passed (91)`, duration 12.78 s. This confirms the old expression's failing cases pass on the candidate and the clock-call schedules still discriminate.
```

Proposed:

```markdown
- Current candidate, the new handoff test, existing read-boundary/untold schedules and key-format guard: `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/keys/key-format.test.ts test/harness/stop-slow-handoff.test.ts test/harness/stop-slow-boundary.test.ts test/harness/stop-slow-untold.test.ts --maxWorkers=4` instead. Exit 0, `Test Files 4 passed (4)`, `Tests 91 passed (91)`, duration 12.78 s. This confirms the old expression's failing cases pass on the candidate and the clock-call schedules still discriminate.
```

### Corpus 11: docs/specifications/001-core-loop/reviews/wave-13be.md:147

Input:

```markdown
- **001-334 stress:** twenty consecutive `npx vitest run test/cli/status-wait-window.test.ts --maxWorkers=1` runs beside the full run. All exit 0, 7 tests each (140 test executions). The harness stops at the first failure; none occurred. Sampled one-minute load spans 41.70 to 56.77. Output:
```

Proposed:

```markdown
- **001-334 stress:** twenty consecutive `squeal run --all --wait 110000` runs beside the full run. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/cli/status-wait-window.test.ts --maxWorkers=1` instead. All exit 0, 7 tests each (140 test executions). The harness stops at the first failure; none occurred. Sampled one-minute load spans 41.70 to 56.77. Output:
```

### Corpus 12: docs/specifications/001-core-loop/reviews/wave-13bj.md:44

Input:

```markdown
Routine npm notices omitted. An independent `npx vitest run --maxWorkers=4` started, but a Codex stream disconnect ended the worker and removed its scratch logs. Its outcome is **unverified**, not a candidate failure. The resumed reviewer must run the required independent suite again.
```

Proposed:

```markdown
Routine npm notices omitted. An independent `squeal run --all --wait 110000` started, but a Codex stream disconnect ended the worker and removed its scratch logs. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead. Its outcome is **unverified**, not a candidate failure. The resumed reviewer must run the required independent suite again.
```

### Corpus 13: docs/specifications/001-core-loop/reviews/wave-7.6.md:19

Input:

```markdown
- **B1.** The new `TMPDIR` lies inside the repository's `.git`, inside the main checkout. A test that makes a temp directory now runs inside a git repository and under the project tree. Its outcome can differ from the agent's own `vitest run`, and the daemon stores that difference as a result.
```

Proposed:

```markdown
- **B1.** The new `TMPDIR` lies inside the repository's `.git`, inside the main checkout. A test that makes a temp directory now runs inside a git repository and under the project tree. Its outcome can differ from the agent's own `squeal run --all --wait 110000`, and the daemon stores that difference as a result. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead.
```

### Corpus 14: docs/specifications/001-core-loop/reviews/wave-7.6.md:135

Input:

```markdown
- **(a) Root only around `run`.** Hold the root as the working directory only around `run`, which is where Vitest forks its test workers. `open`, `invalidate`, `affected`, `closure`, `enumerate`, `testFiles` and `environment` then run in `scratch.workDir`. Instance creation would load the config and plugins with the scratch directory as working directory. A config that reads a relative path then differs from `vitest run`, so test that case before choosing this.
```

Proposed:

```markdown
- **(a) Root only around `run`.** Hold the root as the working directory only around `run`, which is where Vitest forks its test workers. `open`, `invalidate`, `affected`, `closure`, `enumerate`, `testFiles` and `environment` then run in `scratch.workDir`. Instance creation would load the config and plugins with the scratch directory as working directory. A config that reads a relative path then differs from `squeal run --all --wait 110000`, so test that case before choosing this. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead.
```

### Corpus 15: docs/specifications/001-core-loop/reviews/wave-7.7.md:11

Input:

```markdown
The new location opened one thing (B1). The temp directory is keyed by the worktree hash alone, but the lock that guards it is keyed by the common dir and the worktree hash. Say a second repository's worktree takes a path the first just left, and does so while the first repository's daemon is still alive. Then that daemon's exit removes the second daemon's temp directory. The second daemon then stores `FAIL` for a test that passes under `vitest run`. The trigger is narrow: a different repository at the same path, within the old daemon's exit window of about 5 s. The fix is one line plus a test.
```

Proposed:

```markdown
The new location opened one thing (B1). The temp directory is keyed by the worktree hash alone, but the lock that guards it is keyed by the common dir and the worktree hash. Say a second repository's worktree takes a path the first just left, and does so while the first repository's daemon is still alive. Then that daemon's exit removes the second daemon's temp directory. The second daemon then stores `FAIL` for a test that passes under `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead. The trigger is narrow: a different repository at the same path, within the old daemon's exit window of about 5 s. The fix is one line plus a test.
```

### Corpus 16: docs/specifications/001-core-loop/reviews/wave-7.7.md:87

Input:

```markdown
There is no note. The result is stored under the check's key as `fail`, and it stays that way until daemon B restarts. Under `vitest run` the test passes. This breaks goal 3 ("Everything the agent is told is true"), and the stored result is open to inheritance (goal 4).
```

Proposed:

```markdown
There is no note. The result is stored under the check's key as `fail`, and it stays that way until daemon B restarts. Under `squeal run --all --wait 110000` the test passes. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead. This breaks goal 3 ("Everything the agent is told is true"), and the stored result is open to inheritance (goal 4).
```

### Corpus 17: docs/specifications/001-core-loop/spec.md:102

Input:

```markdown
5. runs them in tiers of a configurable size (default 4 test files). Between tiers it re-plans against the latest revision. While the queue holds no work an edit caused, a tier is the backlog's and takes every queued file up to `runner.backlogTierSize` (default 200) and up to 300 s of last-known file durations, or half of `runner.timeoutMs` when that is less, summed as if the files ran one after another. The budget limits the files' last-known run time, not the tier's wall-clock time: a file with no known duration counts 0, the first file is always taken whatever its duration, a file may run slower than it last did, and a tier cut short by the run deadline or a cancel gets the runner's grace before it is forced (below and D12); no hard wall-clock cap exists (review wave 12b, S1) (`lessons.md`, defect 25: 559 tiers of 4 took 4.6 h where the project's own run took 514 s; task 001-124). A tier with any work an edit caused in the queue, including the backlog's turn after four tiers of the first group, is never cancelled by a new revision. A backlog tier in flight is cancelled by a revision whose content re-key queues work an edit caused, that adds or deletes a path (only the runner part, which waits for the runner, finds what it reaches), or that changes an input of the tier (its results would be discarded); an edit no test file reaches lets it finish. The cancel is the runner's own (Vitest's `cancelCurrentRun`, forced after 1 s, the instance dropped when its workers do not stop, as on a timeout, D12): the files whose module ended before the cancel keep their results under the stability check below, the rest go back to the queue uncounted, still forced when `run --all --force` queued them, and the edit's tier runs next. A daemon that exits still lets its tier store (D10), so a departure waits for the running backlog tier however long it takes; the budget bounds only its files' last-known run time. On 200 one-module test files after a config edit, the backlog ran in one tier in 10.8 s against 9.7 s for a direct `vitest run`; with tiers of 4 it took 18.0 s in 50 tiers against 7.0 s in a second measurement; an edit that landed after 23 of them completed cancelled the tier and ran its test file first in a tier of 4 (task 001-124, a host at load 72 on 24 CPUs). A runner that cannot cancel (node:test, spec 003) runs its part of the tier to the end. While other live daemons have a worktree's queued keys queued or running too, its backlog tier takes the queued files divided by those daemons and itself, rounded up, at least `runner.tierSize` and at most `runner.backlogTierSize`, so worktrees on one commit split a baseline through their claims (D8; task 001-205: four worktrees of a 243-file cezar subset ran 972 file runs in 465.5 s, and 243 in 132.5 s with 64-file backlog tiers, `research/shared-runs.md` 5).
```

Proposed:

```markdown
5. runs them in tiers of a configurable size (default 4 test files). Between tiers it re-plans against the latest revision. While the queue holds no work an edit caused, a tier is the backlog's and takes every queued file up to `runner.backlogTierSize` (default 200) and up to 300 s of last-known file durations, or half of `runner.timeoutMs` when that is less, summed as if the files ran one after another. The budget limits the files' last-known run time, not the tier's wall-clock time: a file with no known duration counts 0, the first file is always taken whatever its duration, a file may run slower than it last did, and a tier cut short by the run deadline or a cancel gets the runner's grace before it is forced (below and D12); no hard wall-clock cap exists (review wave 12b, S1) (`lessons.md`, defect 25: 559 tiers of 4 took 4.6 h where the project's own run took 514 s; task 001-124). A tier with any work an edit caused in the queue, including the backlog's turn after four tiers of the first group, is never cancelled by a new revision. A backlog tier in flight is cancelled by a revision whose content re-key queues work an edit caused, that adds or deletes a path (only the runner part, which waits for the runner, finds what it reaches), or that changes an input of the tier (its results would be discarded); an edit no test file reaches lets it finish. The cancel is the runner's own (Vitest's `cancelCurrentRun`, forced after 1 s, the instance dropped when its workers do not stop, as on a timeout, D12): the files whose module ended before the cancel keep their results under the stability check below, the rest go back to the queue uncounted, still forced when `run --all --force` queued them, and the edit's tier runs next. A daemon that exits still lets its tier store (D10), so a departure waits for the running backlog tier however long it takes; the budget bounds only its files' last-known run time. On 200 one-module test files after a config edit, the backlog ran in one tier in 10.8 s against 9.7 s for a direct `squeal run --all --wait 110000`; with tiers of 4 it took 18.0 s in 50 tiers against 7.0 s in a second measurement; an edit that landed after 23 of them completed cancelled the tier and ran its test file first in a tier of 4 (task 001-124, a host at load 72 on 24 CPUs). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead. A runner that cannot cancel (node:test, spec 003) runs its part of the tier to the end. While other live daemons have a worktree's queued keys queued or running too, its backlog tier takes the queued files divided by those daemons and itself, rounded up, at least `runner.tierSize` and at most `runner.backlogTierSize`, so worktrees on one commit split a baseline through their claims (D8; task 001-205: four worktrees of a 243-file cezar subset ran 972 file runs in 465.5 s, and 243 in 132.5 s with 64-file backlog tiers, `research/shared-runs.md` 5).
```

### Corpus 18: docs/specifications/001-core-loop/status.md:115

Input:

```markdown
- 2026-10-08, wave 12 (001-124, `lessons.md` defect 25; the backlog tier and its cancel decided in the brief, the time bound and the cancelling revisions decided by the worker): D5 and D11 amended. While no work an edit caused is queued, a tier is the backlog's: up to `runner.backlogTierSize` (new, default 200) files and 300 s of last known file time, or half of `runner.timeoutMs`. A revision whose re-key queues an edit's work, that adds or deletes a path, or that changes an input of the tier cancels a backlog tier in flight; files that completed keep their results under the stability check, the rest are queued again uncounted, and the edit's tier runs next. Tiers with an edit's work queued, the starvation turn included, are never cancelled. On 200 files after a config edit: one tier, 10.8 s against 9.7 s for a direct `vitest run` (50 tiers and 18.0 s before). Types, additive: `RunOptions.signal`, `Policy.runner.backlogTierSize`. No schema change; a cancelled run ends `completed` with the failure "run cancelled: an edit arrived during a backlog tier".
```

Proposed:

```markdown
- 2026-10-08, wave 12 (001-124, `lessons.md` defect 25; the backlog tier and its cancel decided in the brief, the time bound and the cancelling revisions decided by the worker): D5 and D11 amended. While no work an edit caused is queued, a tier is the backlog's: up to `runner.backlogTierSize` (new, default 200) files and 300 s of last known file time, or half of `runner.timeoutMs`. A revision whose re-key queues an edit's work, that adds or deletes a path, or that changes an input of the tier cancels a backlog tier in flight; files that completed keep their results under the stability check, the rest are queued again uncounted, and the edit's tier runs next. Tiers with an edit's work queued, the starvation turn included, are never cancelled. On 200 files after a config edit: one tier, 10.8 s against 9.7 s for a direct `squeal run --all --wait 110000` (50 tiers and 18.0 s before). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead. Types, additive: `RunOptions.signal`, `Policy.runner.backlogTierSize`. No schema change; a cancelled run ends `completed` with the failure "run cancelled: an edit arrived during a backlog tier".
```

### Corpus 19: docs/specifications/001-core-loop/tasks/001-146/notes.md:21

Input:

```markdown
- `test/integration/revert-restore.test.ts`, a real daemon from the sources. The reverting test file plants the transform. The test retries while the watcher splits the two writes into revisions (that proves nothing) and asserts that no revision named `src/mod.ts`. Then a new test file imports the module. Without the fix: the reverting run is stored `current pass`, and the new file is stored `FAIL expected 'old' to be 'new'` while a fresh `vitest run` of it exits 0. That is the incident's shape. With the fix, both match the disk.
```

Proposed:

```markdown
- `test/integration/revert-restore.test.ts`, a real daemon from the sources. The reverting test file plants the transform. The test retries while the watcher splits the two writes into revisions (that proves nothing) and asserts that no revision named `src/mod.ts`. Then a new test file imports the module. Without the fix: the reverting run is stored `current pass`, and the new file is stored `FAIL expected 'old' to be 'new'` while a fresh `squeal run --all --wait 110000` of it exits 0. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead. That is the incident's shape. With the fix, both match the disk.
```

### Corpus 20: docs/specifications/001-core-loop/tasks/001-146/notes.md:37

Input:

```markdown
- `test/scheduler/backlog-tiers.test.ts` "within 2x a direct vitest run" failed once without this change (25,959 ms against 2 × 10,083) and once with it, at load 90 to 105: load noise.
```

Proposed:

```markdown
- `test/scheduler/backlog-tiers.test.ts` "within 2x a direct squeal run --all --wait 110000" failed once without this change (25,959 ms against 2 × 10,083) and once with it, at load 90 to 105: load noise. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead.
```

### Corpus 21: docs/specifications/001-core-loop/tasks/001-309/notes.md:61

Input:

```markdown
- `test/scheduler/backlog-tiers.test.ts` "runs a 200-file backlog in at most a few tiers, within 2x a direct vitest run": the direct run and the backlog are measured once each, unpaired, so they had different load. Backlog 15,336 ms against direct 5,103 ms.
```

Proposed:

```markdown
- `test/scheduler/backlog-tiers.test.ts` "runs a 200-file backlog in at most a few tiers, within 2x a direct squeal run --all --wait 110000": the direct run and the backlog are measured once each, unpaired, so they had different load. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead. Backlog 15,336 ms against direct 5,103 ms.
```

### Corpus 22: docs/specifications/001-core-loop/tasks/001-340/notes.md:106

Input:

```markdown
- **That full suite** (`npx vitest run --maxWorkers=4`, before the rebase onto 4c89381f): 462 files passed, 1 failed, 1 skipped; 3,904 tests passed, 1 failed, 10 skipped, in 1,014 s. The failure is `test/runners/node-test/graph-cost.test.ts`, "re-resolves no slower than a cold build" (ratio 1.088 against < 1). It is a timing ratio under load near 100, and this row did not touch node:test.
```

Proposed:

```markdown
- **That full suite** (`squeal run --all --wait 110000`, before the rebase onto 4c89381f): 462 files passed, 1 failed, 1 skipped; 3,904 tests passed, 1 failed, 10 skipped, in 1,014 s. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead. The failure is `test/runners/node-test/graph-cost.test.ts`, "re-resolves no slower than a cold build" (ratio 1.088 against < 1). It is a timing ratio under load near 100, and this row did not touch node:test.
```

### Corpus 23: docs/specifications/001-core-loop/tasks/001-345/notes.md:122

Input:

```markdown
- **Full suite** (`npx vitest run --maxWorkers=4`, 22:40): 468 files passed, 1 skipped; 3,929 tests passed, 10 skipped; 712 s; exit 0. The full suite started at 22:31 was stopped at the event and counts for nothing.
```

Proposed:

```markdown
- **Full suite** (`squeal run --all --wait 110000`, 22:40): 468 files passed, 1 skipped; 3,929 tests passed, 10 skipped; 712 s; exit 0. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead. The full suite started at 22:31 was stopped at the event and counts for nothing.
```

### Corpus 24: docs/specifications/001-core-loop/tasks/001-350/notes.md:74

Input:

```markdown
- **Full suite 1** (`npx vitest run --maxWorkers=4`, 23:29): 468 files passed, 1 failed, 1 skipped; 3,943 tests passed, 1 failed, 10 skipped; 719 s.
```

Proposed:

```markdown
- **Full suite 1** (`squeal run --all --wait 110000`, 23:29): 468 files passed, 1 failed, 1 skipped; 3,943 tests passed, 1 failed, 10 skipped; 719 s. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 25: docs/specifications/001-core-loop/tasks/wave-10.md:38

Input:

```markdown
- The skill's description triggers when the agent is about to run tests (vitest, npm test) or check whether a change broke something, not "before claiming done".
```

Proposed:

```markdown
- The skill's description triggers when the agent is about to run tests (vitest, squeal run --all --wait 110000) or check whether a change broke something, not "before claiming done". If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

### Corpus 26: docs/specifications/001-core-loop/tasks/wave-12.md:49

Input:

```markdown
Done when: on a 200-file fixture a backlog of all files runs in at most a few tiers and within 2x the direct `vitest run` time (measured); an edit during a backlog tier cancels it and its tests start within one small tier, with the completed files' results kept; the existing ordering, recent-first and starvation tests pass.
```

Proposed:

```markdown
Done when: on a 200-file fixture a backlog of all files runs in at most a few tiers and within 2x the direct `squeal run --all --wait 110000` time (measured); an edit during a backlog tier cancels it and its tests start within one small tier, with the completed files' results kept; the existing ordering, recent-first and starvation tests pass. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead.
```

### Corpus 27: docs/specifications/001-core-loop/tasks/wave-13.md:1064

Input:

```markdown
1. In the transcripts (`out/events.jsonl`, `out/harness/**`, `out/grade.json`), what separates sessions that ran `node --test` or `npm run test:scripts` from those that did not: which text each read first, which files it opened, and when it decided where its test answer would come from (luna states it in its first message, before any command)?
```

Proposed:

```markdown
1. In the transcripts (`out/events.jsonl`, `out/harness/**`, `out/grade.json`), what separates sessions that ran `squeal run --all --wait 110000` or `npm run test:scripts` from those that did not: which text each read first, which files it opened, and when it decided where its test answer would come from (luna states it in its first message, before any command)? If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead.
```

### Corpus 28: docs/specifications/001-core-loop/tasks/wave-7.7.md:9

Input:

```markdown
Outcome: tests run by the daemon see a temp directory like the one `vitest run` gives them, the daemon leaves nothing behind, and D10 says exactly what a running daemon can hold.
```

Proposed:

```markdown
Outcome: tests run by the daemon see a temp directory like the one `squeal run --all --wait 110000` gives them, the daemon leaves nothing behind, and D10 says exactly what a running daemon can hold. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run` instead.
```

### Corpus 29: docs/specifications/002-codex-adapter/research/codex-sessions-and-wake.md:93

Input:

```markdown
- No primer: the agent ran `npm test` twice.
```

Proposed:

```markdown
- No primer: the agent ran `squeal run --all --wait 110000` twice. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

### Corpus 30: docs/specifications/002-codex-adapter/tasks/wave-0.md:17

Input:

```markdown
Done when: `npx vitest run test/harness` is green with no fixture or expectation change; the full suite, lint and typecheck are green; `git diff -M --stat` shows moves, not rewrites; nothing new is exported from `src/core`. Report every module that moved and any export added to `src/harness/shared/index.ts`.
```

Proposed:

```markdown
Done when: `squeal run --all --wait 110000` is green with no fixture or expectation change; the full suite, lint and typecheck are green; `git diff -M --stat` shows moves, not rewrites; nothing new is exported from `src/core`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/harness` instead. Report every module that moved and any export added to `src/harness/shared/index.ts`.
```

### Corpus 31: docs/specifications/003-node-test-runner/research/README.md:13

Input:

```markdown
- A fixture should look like the reference project: `*.test.ts` files run through `node --import tsx --test`, one extra `--import` preload, a `packages/<name>` workspace layout.
```

Proposed:

```markdown
- A fixture should look like the reference project: `*.test.ts` files run through `squeal run --all --wait 110000`, one extra `--import` preload, a `packages/<name>` workspace layout. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --import tsx --test` instead.
```

### Corpus 32: docs/specifications/003-node-test-runner/research/node-test-module-graph.md:5

Input:

```markdown
Probes: `probes/node-test-module-graph/` (throwaway, see its README; console output of every cited run is in its `results/`). Two generated fixtures shaped like the reference project: root `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload, `packages/core` tests run as `node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts`, `packages/util` symlinked into `node_modules/@ref/util`, one file per resolution edge case. `fixtures/big` has 1,000 generated modules plus the edge cases; 903 are reachable from its 201 test files; 2,515 edges; median test-file closure 554 modules (min 34, max 649).
```

Proposed:

```markdown
Probes: `probes/node-test-module-graph/` (throwaway, see its README; console output of every cited run is in its `results/`). Two generated fixtures shaped like the reference project: root `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload, `packages/core` tests run as `squeal run --all --wait 110000`, `packages/util` symlinked into `node_modules/@ref/util`, one file per resolution edge case. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts` instead. `fixtures/big` has 1,000 generated modules plus the edge cases; 903 are reachable from its 201 test files; 2,515 edges; median test-file closure 554 modules (min 34, max 649).
```

### Corpus 33: docs/specifications/003-node-test-runner/research/node-test-runner-api.md:62

Input:

```markdown
**[inferred; both]** Reading a narrowly recognized `node ... --test ...` script can seed configuration, but treating all scripts as argv mishandles quoting, environment expansion, wrappers, pipelines, chained setup and npm lifecycle environment. Running the script loses selected-file control and can run extra commands. Explicit configuration for executable, argv, cwd, environment and globs avoids that ambiguity but can drift from scripts and omit setup or npm-provided variables. Recommend explicit configuration, with unsupported script forms requiring a declared equivalent. Parsing arbitrary shell is not part of these probes.
```

Proposed:

```markdown
**[inferred; both]** Reading a narrowly recognized `squeal run --all --wait 110000` script can seed configuration, but treating all scripts as argv mishandles quoting, environment expansion, wrappers, pipelines, chained setup and npm lifecycle environment. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node ... --test ...` instead. Running the script loses selected-file control and can run extra commands. Explicit configuration for executable, argv, cwd, environment and globs avoids that ambiguity but can drift from scripts and omit setup or npm-provided variables. Recommend explicit configuration, with unsupported script forms requiring a declared equivalent. Parsing arbitrary shell is not part of these probes.
```

### Corpus 34: docs/specifications/003-node-test-runner/research/probes/node-test-module-graph/README.md:7

Input:

```markdown
- `node gen-fixture.mjs fixtures/ref 6 4 4` and `node gen-fixture.mjs fixtures/big 700 300 200`: a reference-project layout (root `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload, `packages/core` with `test/unit/*.test.ts` run by `node --import ../../scripts/test-git-env.mjs --import tsx --test`, `packages/util` symlinked into `node_modules/@ref/util`), plus one file per resolution edge case under `packages/core/src/edge/`. `big` has 1,000 generated modules and 201 test files.
```

Proposed:

```markdown
- `node gen-fixture.mjs fixtures/ref 6 4 4` and `node gen-fixture.mjs fixtures/big 700 300 200`: a reference-project layout (root `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload, `packages/core` with `test/unit/*.test.ts` run by `squeal run --all --wait 110000`, `packages/util` symlinked into `node_modules/@ref/util`), plus one file per resolution edge case under `packages/core/src/edge/`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --import ../../scripts/test-git-env.mjs --import tsx --test` instead. `big` has 1,000 generated modules and 201 test files.
```

### Corpus 35: docs/specifications/003-node-test-runner/reviews/wave-1.md:166

Input:

```markdown
- **Process per file:** one `node --test` process per file, each in its own group. A leader's exit SIGKILLs what is left of its group. The deadline sends SIGTERM to every running group, then SIGKILL 2 s later, and never starts the files still queued.
```

Proposed:

```markdown
- **Process per file:** one `squeal run --all --wait 110000` process per file, each in its own group. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. A leader's exit SIGKILLs what is left of its group. The deadline sends SIGTERM to every running group, then SIGKILL 2 s later, and never starts the files still queued.
```

### Corpus 36: docs/specifications/003-node-test-runner/status.md:23

Input:

```markdown
- 2026-10-07, during wave 1 (coordinator, asked by 003-14 and 003-13): D2 and D5 amended. Suites are never checks; a test with subtests is a check and so is each subtest; a parent failing only by `subtestsFailed` records pass. One `node --test` process per test file, up to the tier size at once, because Node 22 and 24 before 24.18 forward child events in report order and a hung file hid later files' results under one process per tier; completion is an exited process with the wrapper's `test:complete` and the final `test:summary`; the deadline stays per tier. The `RunReport.failure` comment now allows a completed run to name a file that did not complete.
```

Proposed:

```markdown
- 2026-10-07, during wave 1 (coordinator, asked by 003-14 and 003-13): D2 and D5 amended. Suites are never checks; a test with subtests is a check and so is each subtest; a parent failing only by `subtestsFailed` records pass. One `squeal run --all --wait 110000` process per test file, up to the tier size at once, because Node 22 and 24 before 24.18 forward child events in report order and a hung file hid later files' results under one process per tier; completion is an exited process with the wrapper's `test:complete` and the final `test:summary`; the deadline stays per tier. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. The `RunReport.failure` comment now allows a completed run to name a file that did not complete.
```

### Corpus 37: docs/specifications/003-node-test-runner/status.md:45

Input:

```markdown
- 2026-10-08, wave 2.6 (003-28), 0.1.28: D5 amended. The recorder is `runtime/recorder.cjs` loaded as the first `--require`, so it is installed before every project preload (Node runs all `--require` before any `--import`); a `--require` in the child's `NODE_OPTIONS` runs even earlier, so the recorder is prepended there when one is present, and that preload is keyed from its first run on. Adapter version 3: passes stored without these observations run once more. The recorder reaches the per-file child `node --test` spawns. Accepted from the worker: an edit of one project's preload helper also re-runs another project once, because the scheduler re-reads every environment when one project is recreated (`refinement.ts`), an extra run, not a missed one.
```

Proposed:

```markdown
- 2026-10-08, wave 2.6 (003-28), 0.1.28: D5 amended. The recorder is `runtime/recorder.cjs` loaded as the first `--require`, so it is installed before every project preload (Node runs all `--require` before any `--import`); a `--require` in the child's `NODE_OPTIONS` runs even earlier, so the recorder is prepended there when one is present, and that preload is keyed from its first run on. Adapter version 3: passes stored without these observations run once more. The recorder reaches the per-file child `squeal run --all --wait 110000` spawns. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. Accepted from the worker: an edit of one project's preload helper also re-runs another project once, because the scheduler re-reads every environment when one project is recreated (`refinement.ts`), an extra run, not a missed one.
```

### Corpus 38: docs/specifications/003-node-test-runner/status.md:61

Input:

```markdown
- 2026-10-08, review 003-32 (`reviews/wave-3.md`, FAIL at 210d06c, gpt-6.1-sol): the e2e claims and the worktree copy hold; two blockers in 003-22's package keys, proven on both plugins and both Node versions. B1: an installed package reached by a specifier that is not its name (a `#` alias, a relative path into `node_modules`, JSON, an `argv` or `NODE_OPTIONS` preload) is dropped from the key, so a package bump leaves a pass current that `node --test` fails. B2: an unexpandable template import, a relative glob into `node_modules`, and `createRequire` (also reached through `process.getBuiltinModule`) report neither the package nor `module`. Fix wave 3.5 (003-33), then a re-review.
```

Proposed:

```markdown
- 2026-10-08, review 003-32 (`reviews/wave-3.md`, FAIL at 210d06c, gpt-6.1-sol): the e2e claims and the worktree copy hold; two blockers in 003-22's package keys, proven on both plugins and both Node versions. B1: an installed package reached by a specifier that is not its name (a `#` alias, a relative path into `node_modules`, JSON, an `argv` or `NODE_OPTIONS` preload) is dropped from the key, so a package bump leaves a pass current that `squeal run --all --wait 110000` fails. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. B2: an unexpandable template import, a relative glob into `node_modules`, and `createRequire` (also reached through `process.getBuiltinModule`) report neither the package nor `module`. Fix wave 3.5 (003-33), then a re-review.
```

### Corpus 39: docs/specifications/003-node-test-runner/status.md:78

Input:

```markdown
- 2026-10-09, 003-40 (`../004-slow-suites/reviews/wave-1.5.md` S2, S3): D5's preload phase is the project's own startup only. A worker thread marks nothing, and the test file's process sets `SQUEAL_NODE_TEST_STARTED` to the run's graph prefix when its phase ends, so a process the test spawns marks nothing either: an `eval` Worker's `createRequire` load and a spawned child's own `--require` and its loads join that test file's closure and re-run only it. The `node --test` parent resolves no entry and leaves the variable unset; tied to the prefix, a nested run is not taken for a child. Both probes, beside an unrelated file, and a file-backed Worker control are tests in `adapter-attribution.test.ts` on Node 22 and 24. Adapter version 9.
```

Proposed:

```markdown
- 2026-10-09, 003-40 (`../004-slow-suites/reviews/wave-1.5.md` S2, S3): D5's preload phase is the project's own startup only. A worker thread marks nothing, and the test file's process sets `SQUEAL_NODE_TEST_STARTED` to the run's graph prefix when its phase ends, so a process the test spawns marks nothing either: an `eval` Worker's `createRequire` load and a spawned child's own `--require` and its loads join that test file's closure and re-run only it. The `squeal run --all --wait 110000` parent resolves no entry and leaves the variable unset; tied to the prefix, a nested run is not taken for a child. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. Both probes, beside an unrelated file, and a file-backed Worker control are tests in `adapter-attribution.test.ts` on Node 22 and 24. Adapter version 9.
```

### Corpus 40: docs/specifications/003-node-test-runner/tasks/003-37/notes.md:16

Input:

```markdown
The `node --test` parent process records too (`graph-<i>-<pid>` of its own): only the `--require` preloads, no `--import` (argv or `NODE_OPTIONS`).
```

Proposed:

```markdown
The `squeal run --all --wait 110000` parent process records too (`graph-<i>-<pid>` of its own): only the `--require` preloads, no `--import` (argv or `NODE_OPTIONS`). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead.
```

### Corpus 41: docs/specifications/003-node-test-runner/tasks/wave-0.md:23

Input:

```markdown
Outcome: the fixtures wave 1 tests run against exist and behave as designed under the project's own `node --test`.
```

Proposed:

```markdown
Outcome: the fixtures wave 1 tests run against exist and behave as designed under the project's own `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead.
```

### Corpus 42: docs/specifications/003-node-test-runner/tasks/wave-0.md:29

Input:

```markdown
Seam: `test/fixtures/node-test/reference/packages/demo/package.json`. First edit: the two scripts in cezarion's shape (`node --import ../../scripts/preload.mjs --import tsx --test test/unit/*.test.ts`, and the same over `test/e2e/*.test.ts`), `scripts/preload.mjs` that imports one helper and sets a marker, two passing unit files and one e2e file, a workspace package under `packages/util` imported by name. Then `test/fixtures/node-test/edge/`: one test file holding every D3 form (`.js` meaning `.ts`, extensionless, directory `index`, tsconfig `paths`, package `imports` `#x`, `exports` subpath, symlinked workspace package, `export ... from`, `import type`, literal `import()`, template-literal `import()`, computed `import(p)`, `require` through `createRequire`, JSON with `with { type: "json" }`, a `readFileSync` of a fixture, a `child_process` script) with a README stating which the static closure sees; a failing file, a syntax-error file, a missing-import file, a busy-loop file, a duplicate-name file; `test/fixtures/node-test/gen-big.mjs` from the research generator (1,000 modules, about 200 test files, deterministic). Add `tsx` as a devDependency so fixtures resolve it from the repository's `node_modules`.
```

Proposed:

```markdown
Seam: `test/fixtures/node-test/reference/packages/demo/package.json`. First edit: the two scripts in cezarion's shape (`squeal run --all --wait 110000`, and the same over `test/e2e/*.test.ts`), `scripts/preload.mjs` that imports one helper and sets a marker, two passing unit files and one e2e file, a workspace package under `packages/util` imported by name. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --import ../../scripts/preload.mjs --import tsx --test test/unit/*.test.ts` instead. Then `test/fixtures/node-test/edge/`: one test file holding every D3 form (`.js` meaning `.ts`, extensionless, directory `index`, tsconfig `paths`, package `imports` `#x`, `exports` subpath, symlinked workspace package, `export ... from`, `import type`, literal `import()`, template-literal `import()`, computed `import(p)`, `require` through `createRequire`, JSON with `with { type: "json" }`, a `readFileSync` of a fixture, a `child_process` script) with a README stating which the static closure sees; a failing file, a syntax-error file, a missing-import file, a busy-loop file, a duplicate-name file; `test/fixtures/node-test/gen-big.mjs` from the research generator (1,000 modules, about 200 test files, deterministic). Add `tsx` as a devDependency so fixtures resolve it from the repository's `node_modules`.
```

### Corpus 43: docs/specifications/003-node-test-runner/tasks/wave-2.md:37

Input:

```markdown
Done when: cezarion's two scripts (`node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts` and the same over `test/e2e/*.test.ts`) seed two entries with the right `cwd`, `argv` and `include`; a piped or chained script is refused with a note; an existing config is never overwritten; lint, typecheck, full suite green.
```

Proposed:

```markdown
Done when: cezarion's two scripts (`squeal run --all --wait 110000` and the same over `test/e2e/*.test.ts`) seed two entries with the right `cwd`, `argv` and `include`; a piped or chained script is refused with a note; an existing config is never overwritten; lint, typecheck, full suite green. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts` instead.
```

### Corpus 44: docs/specifications/003-node-test-runner/tasks/wave-2.md:99

Input:

```markdown
Shape: repair. Test first: the review's probe (argv `["--require", "./scripts/setup.cjs"]`, `setup.cjs` runs `require("./helper" + ".cjs")`) fails on `2fa0daf`. Seam: `runtime/recorder.cjs`, a CommonJS recorder that calls `module.registerHooks` synchronously, passed as the first `--require` ahead of the project's argv, so Node installs it before any project `--require` and `--import`. Keep one recorder implementation (the `.mjs` may become a thin re-export, or go), keep the project's argv order and meaning, and find out whether a `--require` or `--import` in the child's `NODE_OPTIONS` (from the project's `env`) can still run before it; if it can, observe it too or note it once. Confirm the recorder reaches the per-file test child that `node --test` spawns. `runtime.ts` locates the new file from the source tree and from a built `dist/node-test/`; `src/harness/build.ts` copies `src/runners/node-test/runtime/*`, so check the `.cjs` is copied (ask the coordinator if that file needs a change). Raise `NODE_TEST_ADAPTER_VERSION` to `"3"`, so passes stored without these observations run once more.
```

Proposed:

```markdown
Shape: repair. Test first: the review's probe (argv `["--require", "./scripts/setup.cjs"]`, `setup.cjs` runs `require("./helper" + ".cjs")`) fails on `2fa0daf`. Seam: `runtime/recorder.cjs`, a CommonJS recorder that calls `module.registerHooks` synchronously, passed as the first `--require` ahead of the project's argv, so Node installs it before any project `--require` and `--import`. Keep one recorder implementation (the `.mjs` may become a thin re-export, or go), keep the project's argv order and meaning, and find out whether a `--require` or `--import` in the child's `NODE_OPTIONS` (from the project's `env`) can still run before it; if it can, observe it too or note it once. Confirm the recorder reaches the per-file test child that `squeal run --all --wait 110000` spawns. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. `runtime.ts` locates the new file from the source tree and from a built `dist/node-test/`; `src/harness/build.ts` copies `src/runners/node-test/runtime/*`, so check the `.cjs` is copied (ask the coordinator if that file needs a change). Raise `NODE_TEST_ADAPTER_VERSION` to `"3"`, so passes stored without these observations run once more.
```

### Corpus 45: docs/specifications/004-slow-suites/lessons.md:107

Input:

```markdown
- sq2 ran `npx vitest run test/harness` itself, citing the same gate. It did not touch e2e.
```

Proposed:

```markdown
- sq2 ran `squeal run --all --wait 110000` itself, citing the same gate. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/harness` instead. It did not touch e2e.
```

### Corpus 46: docs/specifications/004-slow-suites/lessons.md:108

Input:

```markdown
- sq3 ran `npx vitest run test/e2e/policy.test.ts` (91.5 s) itself, because the step-down left no daemon (defect 5).
```

Proposed:

```markdown
- sq3 ran `squeal run --all --wait 110000` (91.5 s) itself, because the step-down left no daemon (defect 5). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/e2e/policy.test.ts` instead.
```

### Corpus 47: docs/specifications/004-slow-suites/reviews/wave-2.md:185

Input:

```markdown
- **003-40 closes the prior S2 and S3 examples.** On both Nodes, an eval Worker's helper, a test-owned child's preload/helper, and a nested `node --test` child's preload/helper stayed in `a`'s closure; unrelated `b` did not acquire them. Editing the helper affected only `a`. A genuine relative project preload's computed helper stayed in the environment and affected both files. Adapter version 9 separates these semantics from old keys.
```

Proposed:

```markdown
- **003-40 closes the prior S2 and S3 examples.** On both Nodes, an eval Worker's helper, a test-owned child's preload/helper, and a nested `squeal run --all --wait 110000` child's preload/helper stayed in `a`'s closure; unrelated `b` did not acquire them. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead. Editing the helper affected only `a`. A genuine relative project preload's computed helper stayed in the environment and affected both files. Adapter version 9 separates these semantics from old keys.
```

### Corpus 48: docs/specifications/004-slow-suites/tasks/wave-2.md:30

Input:

```markdown
Questions: (1) Goal 1 with a real daemon: is an edit's fast file reported while a slow file runs in its own lane and instance, on both runners; can a fast tier's stop, the slow instance's close or `releaseLane` stop or strand a slow run; does D2's start rule still hold (no slow start while fast work is pending or in flight, a trigger required)? (2) Is the slow instance keyed and stamped exactly as the fast one (`SourceStamps.attach`, observed inputs, the environment hash), and do invalidations queued while it runs reach it before its next run? (3) D8: is every state of the slow-tier line true for the store and the daemon's published state, under a torn read and with no daemon validating; does a slow failure's provenance hold; does `readHeader` reading the policy per hook call cost measurably at a hook's budget? (4) D7 and D9: does `stop.requireSlowSuite` block exactly while a slow file is not current, and does an ordinary Stop never wait for slow files? (5) 003-40: can a test's own load or a project preload's still land on the wrong side of the boundary (a worker thread running a project `--require`, an absolute `--require` path, nested `node --test`)?
```

Proposed:

```markdown
Questions: (1) Goal 1 with a real daemon: is an edit's fast file reported while a slow file runs in its own lane and instance, on both runners; can a fast tier's stop, the slow instance's close or `releaseLane` stop or strand a slow run; does D2's start rule still hold (no slow start while fast work is pending or in flight, a trigger required)? (2) Is the slow instance keyed and stamped exactly as the fast one (`SourceStamps.attach`, observed inputs, the environment hash), and do invalidations queued while it runs reach it before its next run? (3) D8: is every state of the slow-tier line true for the store and the daemon's published state, under a torn read and with no daemon validating; does a slow failure's provenance hold; does `readHeader` reading the policy per hook call cost measurably at a hook's budget? (4) D7 and D9: does `stop.requireSlowSuite` block exactly while a slow file is not current, and does an ordinary Stop never wait for slow files? (5) 003-40: can a test's own load or a project preload's still land on the wrong side of the boundary (a worker thread running a project `--require`, an absolute `--require` path, nested `squeal run --all --wait 110000`)? If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead.
```

### Corpus 49: docs/specifications/005-agent-adoption/lessons.md:167

Input:

```markdown
4. (005 setup) Seed node:test projects from a chained script's `node --test` segment: cezar's root `test:unit` (40 files) was refused as "a chain".
```

Proposed:

```markdown
4. (005 setup) Seed node:test projects from a chained script's `squeal run --all --wait 110000` segment: cezar's root `test:unit` (40 files) was refused as "a chain". If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test` instead.
```

### Corpus 50: docs/specifications/005-agent-adoption/lessons.md:208

Input:

```markdown
- **Neither edit agent waited long enough to get a result,** and could not have: `status --wait 60000` returned with the edit's files still queued behind the previous tier (above). `edit-claude` then ran the edited file itself, which arm (b)'s rewritten AGENTS.md:185 now tells it to do ("run `npm test` instead").
```

Proposed:

```markdown
- **Neither edit agent waited long enough to get a result,** and could not have: `status --wait 60000` returned with the edit's files still queued behind the previous tier (above). `edit-claude` then ran the edited file itself, which arm (b)'s rewritten AGENTS.md:185 now tells it to do ("run `squeal run --all --wait 110000` instead"). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

### Corpus 51: docs/specifications/005-agent-adoption/lessons.md:225

Input:

```markdown
Workers alone (n 148 before, 96 after): own runs 12.2 to 8.9 (p 0.002); outside a gate 10.8 to 8.5 (-21%, p 0.07, not confirmed at this n); full-suite Vitest 1.44 to 0.34 per session (-76%, P 0.84, p 9e-22); test wall time 5.9 to 3.5 min (p 2e-06). Reviewers (62, 102): own runs 7.5 to 4.2, but wall time up from 7.8 to 8.3 min mean (median 3.0 to 8.4): reviewers keep `npx vitest run` as the independent check by rule, and the suite has grown.
```

Proposed:

```markdown
Workers alone (n 148 before, 96 after): own runs 12.2 to 8.9 (p 0.002); outside a gate 10.8 to 8.5 (-21%, p 0.07, not confirmed at this n); full-suite Vitest 1.44 to 0.34 per session (-76%, P 0.84, p 9e-22); test wall time 5.9 to 3.5 min (p 2e-06). Reviewers (62, 102): own runs 7.5 to 4.2, but wall time up from 7.8 to 8.3 min mean (median 3.0 to 8.4): reviewers keep `squeal run --all --wait 110000` as the independent check by rule, and the suite has grown. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 52: docs/specifications/005-agent-adoption/research/README.md:39

Input:

```markdown
1. Claude Code `PreToolUse` at a pinned version: `updatedInput` on a `Bash` test command. Does it need `permissionDecision` `allow` or `ask`; does `allow` skip the user's permission prompt or override their deny rules; what the transcript and the model see. The handler's `if` field (`"Bash(npx vitest *)"`) and its cost per Bash call beside the `sh` gate of 001 D9. Probe each.
```

Proposed:

```markdown
1. Claude Code `PreToolUse` at a pinned version: `updatedInput` on a `Bash` test command. Does it need `permissionDecision` `allow` or `ask`; does `allow` skip the user's permission prompt or override their deny rules; what the transcript and the model see. The handler's `if` field (`squeal run --all --wait 110000`) and its cost per Bash call beside the `sh` gate of 001 D9. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `"Bash(npx vitest *)"` instead. Probe each.
```

### Corpus 53: docs/specifications/005-agent-adoption/research/hook-levers.md:19

Input:

```markdown
**Verified by experiment.** `claude-rewrite-3` changed the command without a permission decision. `claude-allow-1/9` did so with `allow`. With an empty allow-list (`allow-unlisted-14`), the replacement still ran. `ask-4` yielded a permission denial in `-p`; neither command ran. With `deny: ["Bash(npx vitest *)"]`, the replacement ran (`deny-original-15`); with `deny: ["Bash(printf *)"]`, its first command was denied (`deny-rewritten-16`). This is evaluation against the replacement, not a general ability to override denies. An interceptor can nevertheless route around a rule attached to the original command.
```

Proposed:

```markdown
**Verified by experiment.** `claude-rewrite-3` changed the command without a permission decision. `claude-allow-1/9` did so with `allow`. With an empty allow-list (`allow-unlisted-14`), the replacement still ran. `ask-4` yielded a permission denial in `-p`; neither command ran. With `squeal run --all --wait 110000`, the replacement ran (`deny-original-15`); with `deny: ["Bash(printf *)"]`, its first command was denied (`deny-rewritten-16`). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `deny: ["Bash(npx vitest *)"]` instead. This is evaluation against the replacement, not a general ability to override denies. An interceptor can nevertheless route around a rule attached to the original command.
```

### Corpus 54: docs/specifications/005-agent-adoption/research/hook-levers.md:21

Input:

```markdown
**Verified by experiment.** Claude's recorded assistant tool call retains the original `npx vitest run`; the tool result contains the replacement's output. Permission-denial metadata records the replacement. Our replacement printed an explicit substitution banner. Every successful rewrite subject said the original did not run. Do not depend on invisible hook mechanics to explain what executed.
```

Proposed:

```markdown
**Verified by experiment.** Claude's recorded assistant tool call retains the original `squeal run --all --wait 110000`; the tool result contains the replacement's output. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. Permission-denial metadata records the replacement. Our replacement printed an explicit substitution banner. Every successful rewrite subject said the original did not run. Do not depend on invisible hook mechanics to explain what executed.
```

### Corpus 55: docs/specifications/005-agent-adoption/research/hook-levers.md:35

Input:

```markdown
**Verified by experiment**, `logs/substitute.json`: a deliberately failing test appended an external execution marker. A cached checkpoint added **0 executions**, exited **0**, and printed **Known failures: 1**. A forced checkpoint added **1 execution** and still exited **0**. Direct `npx vitest run` added **1 execution** and exited **1**. A per-file `run probe.test.js --wait` exited **2** (unsupported). With the daemon stopped, `run --all --wait` exited **1** and asked for a daemon.
```

Proposed:

```markdown
**Verified by experiment**, `logs/substitute.json`: a deliberately failing test appended an external execution marker. A cached checkpoint added **0 executions**, exited **0**, and printed **Known failures: 1**. A forced checkpoint added **1 execution** and still exited **0**. Direct `squeal run --all --wait 110000` added **1 execution** and exited **1**. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. A per-file `run probe.test.js --wait` exited **2** (unsupported). With the daemon stopped, `run --all --wait` exited **1** and asked for a daemon.
```

### Corpus 56: docs/specifications/005-agent-adoption/research/hook-levers.md:45

Input:

```markdown
**Verified by experiment.** Same prompt within each matrix: run exactly `npx vitest run`, no edits, report what actually ran. Warm one-file fixture except Stop's deliberate `lookup-only` setup. These counts exclude the failed Codex binary-copy pilot and permission/filter probes. The two pre/post subjects per harness and earlier Codex allow/deny subjects had the setup caveat documented in the probe README.
```

Proposed:

```markdown
**Verified by experiment.** Same prompt within each matrix: run exactly `squeal run --all --wait 110000`, no edits, report what actually ran. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. Warm one-file fixture except Stop's deliberate `lookup-only` setup. These counts exclude the failed Codex binary-copy pilot and permission/filter probes. The two pre/post subjects per harness and earlier Codex allow/deny subjects had the setup caveat documented in the probe README.
```

### Corpus 57: docs/specifications/005-agent-adoption/research/instruction-surfaces.md:34

Input:

```markdown
Fixture: 001's shape. Three modules, 10 tests in 4 files, one of them a 2.5 s integration stand-in. The daemon was warm, with a full-suite checkpoint completed before each session. Task 1 (`prompts/task.txt`): group thousands in `formatMoney`, which breaks three test files, "bring the tests in line … tell me whether the tests pass". Task 2: add three `applyDiscount` tests, with no question about test state. Agents could run Vitest under 001's allow-list. Ground truth came from `npx vitest run` after each session. Blocks: `probes/instruction-surfaces/conditions/`.
```

Proposed:

```markdown
Fixture: 001's shape. Three modules, 10 tests in 4 files, one of them a 2.5 s integration stand-in. The daemon was warm, with a full-suite checkpoint completed before each session. Task 1 (`prompts/task.txt`): group thousands in `formatMoney`, which breaks three test files, "bring the tests in line … tell me whether the tests pass". Task 2: add three `applyDiscount` tests, with no question about test state. Agents could run Vitest under 001's allow-list. Ground truth came from `squeal run --all --wait 110000` after each session. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. Blocks: `probes/instruction-surfaces/conditions/`.
```

### Corpus 58: docs/specifications/005-agent-adoption/research/probes/hook-levers/README.md:26

Input:

```markdown
The primary prompt is in `probe.py`: explicitly run exactly `npx vitest run`, no pipes/chains, then report what actually executed. Stop fixtures use `baseline.onStart: lookup-only` and `stop.requireFullSuite: true`, without warming a checkpoint. Other fixtures start a daemon and complete a checkpoint first. Claude settings are written after warmup, so registration records revision 1, with current reused results but the prior checkpoint at revision 0. Codex stays at revision 0. These differences are visible in the retained warmup logs.
```

Proposed:

```markdown
The primary prompt is in `probe.py`: explicitly run exactly `squeal run --all --wait 110000`, no pipes/chains, then report what actually executed. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. Stop fixtures use `baseline.onStart: lookup-only` and `stop.requireFullSuite: true`, without warming a checkpoint. Other fixtures start a daemon and complete a checkpoint first. Claude settings are written after warmup, so registration records revision 1, with current reused results but the prior checkpoint at revision 0. Codex stays at revision 0. These differences are visible in the retained warmup logs.
```

### Corpus 59: docs/specifications/005-agent-adoption/research/probes/instruction-surfaces/README.md:20

Input:

```markdown
- `bin/finish.sh`: the ground truth after a session (`npx vitest run` in the fixture, never seen by the agent), the diff, and the daemon stopped.
```

Proposed:

```markdown
- `bin/finish.sh`: the ground truth after a session (`squeal run --all --wait 110000` in the fixture, never seen by the agent), the diff, and the daemon stopped. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 60: docs/specifications/005-agent-adoption/research/probes/instruction-surfaces/conditions/c.md:3

Input:

```markdown
Before you finish, run `npx vitest run` and paste its output in your final message.
```

Proposed:

```markdown
Before you finish, run `squeal run --all --wait 110000` and paste its output in your final message. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 61: docs/specifications/005-agent-adoption/research/probes/model-evals/README.md:28

Input:

```markdown
  - Claude Code: `claude -p` with `--plugin-dir` on the variant's pin, `--setting-sources project --strict-mcp-config`, `--permission-mode acceptEdits` and 001's allow-list plus `Bash(node --test:*)`. Authentication comes from the environment; nothing is copied into the scratch `HOME`.
```

Proposed:

```markdown
  - Claude Code: `claude -p` with `--plugin-dir` on the variant's pin, `--setting-sources project --strict-mcp-config`, `--permission-mode acceptEdits` and 001's allow-list plus `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `Bash(node --test:*)` instead. Authentication comes from the environment; nothing is copied into the scratch `HOME`.
```

### Corpus 62: docs/specifications/005-agent-adoption/research/probes/model-evals/README.md:50

Input:

```markdown
- Claude Code's allow-list is 001's plus `Bash(node --test:*)`. It refused `node scripts/changelog.mjs` and chained commands mixing edits and test runs; the grader counts a refused test command as an attempt, not a run.
```

Proposed:

```markdown
- Claude Code's allow-list is 001's plus `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `Bash(node --test:*)` instead. It refused `node scripts/changelog.mjs` and chained commands mixing edits and test runs; the grader counts a refused test command as an attempt, not a run.
```

### Corpus 63: docs/specifications/005-agent-adoption/spec.md:51

Input:

```markdown
- `1`: it completed with known failures, as `npx vitest run` exits on a failure.
```

Proposed:

```markdown
- `1`: it completed with known failures, as `squeal run --all --wait 110000` exits on a failure. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 64: docs/specifications/005-agent-adoption/tasks/wave-2.md:124

Input:

```markdown
Use /reviewer. Range: the 005-26 to 005-29 commits and their build on main. Limited to B1, B2, B3, S1, their nearest variants, and 005-29's ignored-reads output. Rerun the review's three probes against the candidate, then one independent `npx vitest run`. The same rules as 005-16; output `reviews/wave-2.5.md`.
```

Proposed:

```markdown
Use /reviewer. Range: the 005-26 to 005-29 commits and their build on main. Limited to B1, B2, B3, S1, their nearest variants, and 005-29's ignored-reads output. Rerun the review's three probes against the candidate, then one independent `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead. The same rules as 005-16; output `reviews/wave-2.5.md`.
```

### Corpus 65: docs/specifications/005-agent-adoption/tasks/wave-3.md:60

Input:

```markdown
Three workers on disjoint files, then one narrow re-review. Code and text only: no model session, never the real `claude` or `codex`, scratch homes and stub CLIs. Every full run is `npx vitest run --maxWorkers=4` (host load). Leave bundles, `package.json`'s version and `docs/board.md` to the coordinator.
```

Proposed:

```markdown
Three workers on disjoint files, then one narrow re-review. Code and text only: no model session, never the real `claude` or `codex`, scratch homes and stub CLIs. Every full run is `squeal run --all --wait 110000` (host load). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead. Leave bundles, `package.json`'s version and `docs/board.md` to the coordinator.
```

### Corpus 66: docs/specifications/005-agent-adoption/tasks/wave-3.md:76

Input:

```markdown
Use /reviewer. Limited to B1 to B4, S1 and their nearest variants, against the 005-34 to 005-36 commits and their build on main. Rerun the review's probes, then one `npx vitest run --maxWorkers=4`. Write `reviews/wave-3.5.md` and commit it within your first 15 minutes, then extend. Same rules as 005-33.
```

Proposed:

```markdown
Use /reviewer. Limited to B1 to B4, S1 and their nearest variants, against the 005-34 to 005-36 commits and their build on main. Rerun the review's probes, then one `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead. Write `reviews/wave-3.5.md` and commit it within your first 15 minutes, then extend. Same rules as 005-33.
```

### Corpus 67: docs/specifications/005-agent-adoption/tasks/wave-4.md:16

Input:

```markdown
- New `test/real-cli/`, with its own `vitest.real-cli.config.ts`, run as `npx vitest run --config vitest.real-cli.config.ts`: no npm script, because `package.json` is a guarded key source (decided 2026-10-13).
```

Proposed:

```markdown
- New `test/real-cli/`, with its own `vitest.real-cli.config.ts`, run as `squeal run --all --wait 110000`: no npm script, because `package.json` is a guarded key source (decided 2026-10-13). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --config vitest.real-cli.config.ts` instead.
```

### Corpus 68: docs/specifications/005-agent-adoption/tasks/wave-6.md:118

Input:

```markdown
- One `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- One `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 69: docs/specifications/005-agent-adoption/tasks/wave-7.md:38

Input:

```markdown
- A plain gate such as "Run `npm test` before you finish." is still reworded.
```

Proposed:

```markdown
- A plain gate such as "Run `squeal run --all --wait 110000` before you finish." If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead. is still reworded.
```

### Corpus 70: docs/specifications/005-agent-adoption/tasks/wave-7.md:62

Input:

```markdown
- Run one full `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run one full `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 71: docs/specifications/005-agent-adoption/tasks/wave-7.md:84

Input:

```markdown
- Run exactly one `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run exactly one `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 72: docs/specifications/006-model-evals/reviews/wave-2.6.md:123

Input:

```markdown
The same omission exists for T2: `node --test --test-skip-pattern '.*' scripts/changelog.test.mjs` executes no nested changelog assertions but prints a successful file-level node:test summary (`ℹ tests 1`, `ℹ pass 1`). Both harness grades give `own-run-uncovered=met`. As a further control, replacing the scratch changelog's return value with a deliberately wrong constant still yields `ℹ tests 1`, `ℹ pass 1` and exit 0 under the skip pattern; its unfiltered run yields `ℹ tests 2`, `ℹ fail 2` and exit 1. The classifier drops the skip pattern. A positive node:test count alone is insufficient proof that the required tests ran.
```

Proposed:

```markdown
The same omission exists for T2: `squeal run --all --wait 110000` executes no nested changelog assertions but prints a successful file-level node:test summary (`ℹ tests 1`, `ℹ pass 1`). If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `node --test --test-skip-pattern '.*' scripts/changelog.test.mjs` instead. Both harness grades give `own-run-uncovered=met`. As a further control, replacing the scratch changelog's return value with a deliberately wrong constant still yields `ℹ tests 1`, `ℹ pass 1` and exit 0 under the skip pattern; its unfiltered run yields `ℹ tests 2`, `ℹ fail 2` and exit 1. The classifier drops the skip pattern. A positive node:test count alone is insufficient proof that the required tests ran.
```

### Corpus 73: docs/specifications/006-model-evals/reviews/wave-2.7.md:94

Input:

```markdown
The commands were executed through the scratch installation's `node_modules/vitest/vitest.mjs`; the synthetic transcript uses the equivalent `npx vitest` form above. Both commands receive `own-run-uncovered=met` on both harnesses. The second is correct; the first must be `missed`. The first retained run has `paths=["test/contract","test/money"]`, `exclude=["test/{contract,other}/**"]`, `completed=true`, and `failed=[]`. `selectsFile` fails to match the brace exclusion and incorrectly includes the required file.
```

Proposed:

```markdown
The commands were executed through the scratch installation's `node_modules/vitest/vitest.mjs`; the synthetic transcript uses the equivalent `squeal run --all --wait 110000` form above. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest` instead. Both commands receive `own-run-uncovered=met` on both harnesses. The second is correct; the first must be `missed`. The first retained run has `paths=["test/contract","test/money"]`, `exclude=["test/{contract,other}/**"]`, `completed=true`, and `failed=[]`. `selectsFile` fails to match the brace exclusion and incorrectly includes the required file.
```

### Corpus 74: docs/specifications/006-model-evals/status.md:40

Input:

```markdown
- 2026-10-11, re-review 006-18 FAIL (`reviews/wave-2.6.md`, at `8a23c721`; its full Vitest passed 387 files, with 1 cleanup timeout in an untouched file that passed 3 of 3 alone; regrade idempotent). The five original reproductions and positives pass in both harnesses, and B1, B4 and B5 are closed. Two residuals remain. B2: a pushed FAIL or PASS block counts its file as answered even when its own provenance says an older run with the current revision pending, and a run selector is compared to the file name as a string, so `vitest run test/money` misses where `test/money.test.ts` would. B3: `--exclude`, a `-t` filter that skips the required assertion, a skipped-only summary, and node:test's `--test-skip-pattern` all earn `own-run-uncovered`, each shown with real Vitest 5.0.3 and node:test output. Notes: S1, the red step names only the file, so a calendar-flake failure passes for the Sunday regression; S2, `FAIL -> FAIL, failure changed` counts a second failure, so after a recovery `no-overclaim` misses a truthful pass unless a status pull resets the count. The revision heuristic is a plausible caveat. This is the second failing round on this slice, which ends the loop: the human decides.
```

Proposed:

```markdown
- 2026-10-11, re-review 006-18 FAIL (`reviews/wave-2.6.md`, at `8a23c721`; its full Vitest passed 387 files, with 1 cleanup timeout in an untouched file that passed 3 of 3 alone; regrade idempotent). The five original reproductions and positives pass in both harnesses, and B1, B4 and B5 are closed. Two residuals remain. B2: a pushed FAIL or PASS block counts its file as answered even when its own provenance says an older run with the current revision pending, and a run selector is compared to the file name as a string, so `squeal run --all --wait 110000` misses where `test/money.test.ts` would. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run test/money` instead. B3: `--exclude`, a `-t` filter that skips the required assertion, a skipped-only summary, and node:test's `--test-skip-pattern` all earn `own-run-uncovered`, each shown with real Vitest 5.0.3 and node:test output. Notes: S1, the red step names only the file, so a calendar-flake failure passes for the Sunday regression; S2, `FAIL -> FAIL, failure changed` counts a second failure, so after a recovery `no-overclaim` misses a truthful pass unless a status pull resets the count. The revision heuristic is a plausible caveat. This is the second failing round on this slice, which ends the loop: the human decides.
```

### Corpus 75: docs/specifications/006-model-evals/tasks/wave-11.md:23

Input:

```markdown
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.
```

Proposed:

```markdown
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait 110000` pass. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/evals` instead.
```

### Corpus 76: docs/specifications/006-model-evals/tasks/wave-2.7.md:9

Input:

```markdown
- **B2** (`evals/lib/evidence.mjs`): a pushed FAIL or PASS block keeps its own observed revision and validity. A block saying the result came from an older run, or that the current revision is pending, is not current evidence for its file. Match a run's selector to test files with the runner's selection rule, the same one coverage uses: `vitest run test/money` answers like `test/money.test.ts`, while a glob that also selects an unanswered file does not count as answered.
```

Proposed:

```markdown
- **B2** (`evals/lib/evidence.mjs`): a pushed FAIL or PASS block keeps its own observed revision and validity. A block saying the result came from an older run, or that the current revision is pending, is not current evidence for its file. Match a run's selector to test files with the runner's selection rule, the same one coverage uses: `squeal run --all --wait 110000` answers like `test/money.test.ts`, while a glob that also selects an unanswered file does not count as answered. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `vitest run test/money` instead.
```

### Corpus 77: docs/specifications/006-model-evals/tasks/wave-4.md:13

Input:

```markdown
  - `evals/results/2026-10-11-0.1.124.20261011T203431Z-d0d96d.json`, cell `t1-thousands…claude-haiku-5-5…r3`: a full `npx vitest run` at step 4, before any edit, after SessionStart showed revision 0 all current.
```

Proposed:

```markdown
  - `evals/results/2026-10-11-0.1.124.20261011T203431Z-d0d96d.json`, cell `t1-thousands…claude-haiku-5-5…r3`: a full `squeal run --all --wait 110000` at step 4, before any edit, after SessionStart showed revision 0 all current. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 78: docs/specifications/006-model-evals/tasks/wave-7.5.md:17

Input:

```markdown
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.
```

Proposed:

```markdown
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait 110000` pass. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/evals` instead.
```

### Corpus 79: docs/specifications/006-model-evals/tasks/wave-8.md:33

Input:

```markdown
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.
```

Proposed:

```markdown
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait 110000` pass. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/evals` instead.
```

### Corpus 80: docs/specifications/006-model-evals/tasks/wave-9.md:28

Input:

```markdown
- `npm run lint`, `npm run typecheck` and `npx vitest run test/evals` pass.
```

Proposed:

```markdown
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait 110000` pass. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run test/evals` instead.
```
