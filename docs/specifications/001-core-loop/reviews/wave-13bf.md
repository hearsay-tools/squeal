# Wave 13bf: second review of 001-320 after 001-331

**PASS 914258675bed41a898a8cd86c38b267acb912b51**

Range: `cf0eb979..91425867`, pinned exactly. Reviewer row: 001-339. Bounded by `reviews/wave-13bb.md`: re-check B1, N1 and N2, inspect the repair delta, and leave new observations as notes. Counts: zero blockers; one plausible should-fix note; one proven nit.

## Verification

The candidate matched `git rev-parse HEAD`; the tracked tree was clean before all candidate checks. `npm ci` used the lockfile. Every executable check and probe used a fresh HOME outside the checkout:

```sh
env -u CODEX_SESSION_ID \
  HOME="$review_scratch/home" \
  CODEX_HOME="$review_scratch/home/.codex" \
  CLAUDE_CONFIG_DIR="$review_scratch/home/.claude" \
  XDG_CONFIG_HOME="$review_scratch/home/.config" \
  GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
```

The independent Vitest run kept `--maxWorkers=4`. No Squeal checkpoint replaced it, no eval runner was invoked, and no candidate files were edited for verification. One full run, no rerun to green. Routine npm notices and repeated experimental warnings are omitted below.

```text
$ git rev-parse HEAD
914258675bed41a898a8cd86c38b267acb912b51
$ git status --porcelain
[no output]

$ npm ci
added 56 packages, and audited 57 packages in 5s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
[exit 0]

$ npm run lint
> squeal@0.1.150 lint
> biome check .
Checked 980 files in 451ms. No fixes applied.
[exit 0]

$ npm run typecheck
> squeal@0.1.150 typecheck
> tsc --noEmit
[exit 0]

$ npm run build
> squeal@0.1.150 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.150 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]
$ git status --porcelain
[no output]

$ npx vitest run --maxWorkers=4
RUN  v5.0.3
Test Files  461 passed | 1 skipped (462)
     Tests  3898 passed | 10 skipped (3908)
  Start at  20:22:31
  Duration  554.91s (tests 97%, import 2%, transform 1%)
   Isolate  462 workers spawned · ~139ms startup each
[exit 0]
$ git status --porcelain
[no output]

$ node --disable-warning=ExperimentalWarning <scratch>/probe.mjs
[after correcting the probe's missing exports, described below]
tmpfs body-failure teardown: base and runtime removed
absent-/dev/shm selection: complete Codex fixture built under /tmp and removed
tmpfs build-failure cleanup: base and runtime removed
no fixture daemon left; probe PASS
[exit 0]
```

There were no test failures in this full run, including no bad-config timeout. The runner's aggregate output did not print the six budget samples, so this review does not claim fresh per-hook timing numbers. Sampled one-minute host load ranged from 11.80 to 36.65. The full run printed two routine fixture `gitdir` repairs, reclaimed one process an earlier run left, and emitted Vitest's experimental type-testing warnings; none was a test failure. The build left both committed plugin bundles unchanged.

The scratch-only fixture probe bundles the candidate helper with Vitest lifecycle registration stubs and the correct repository constants. It runs the actual fixture factory and registered `afterEach`, simulates an absent `/dev/shm` at `existsSync`, and injects a missing overlay to fail fixture construction. It does not stub fixture building or cleanup. Its initial load failed because the probe stubs omitted exports: `No matching export in "review:vitest" for import "expect"` and `No matching export in "src/harness/claude-code/build.ts" for import "PLUGIN_DIST"` (exit 1). Correcting those probe-only stubs produced the output above. This was a reviewer probe setup failure, not a candidate failure.

Historical stress evidence in the notes is **unverified as a fresh run of this exact candidate**: it names `0e9550f3`, and the scratch instrumentation and raw stress logs are not committed. Both executable files, `harness.ts` and `lifecycle.test.ts`, are byte-identical at that stress revision and this candidate. The reported twenty loaded iterations therefore support the repaired code, but are separate from the independent candidate verification above. The original 4,428 ms SessionStart was not traced; the notes correctly label attributing that particular sample to SQLite as an inference. No macOS or Linux `noexec` tmpfs execution was performed.

## Blockers

None.

## Previous findings

### B1: resolved on the repair's evidence and independent candidate check

The measured failing `pre` sample spent 4,193 ms in SQLite, including 3,502 ms in one `COMMIT`, against a 97 ms reference. The reported outside-SQLite maximum was 584 ms; socket refusal and spawn were a few milliseconds. WAL growth from zero to one frame, unchanged database mtime, slow last-connection close, and the bare-fsync contrast between ext4 `/tmp` and tmpfs support a storage-stall explanation. They do not independently reproduce the original SessionStart outlier. The tmpfs comparison reduced measured SQLite p50/p95/max to 1/3/9 ms; the reported twenty loaded iterations kept all 120 budgeted hooks at or below 430 ms. The separate bad-config failure on iteration 8 is explicitly preserved, not counted as a wholly green lifecycle iteration.

The repair addresses that demonstrated fixture condition without changing hook behavior: only the two dead-daemon cases pass `{ tmpfs: true }`. Repository, plugin copy and `.git/squeal/store.sqlite` move together. Cached install and private socket runtime stay under `/tmp`. The bad-config fixture remains on disk. A direct comparison confirms the whole budget function and all subsequent test bodies are identical after substituting only those two fixture arguments. Target-before-reference order, three PreToolUse calls, `max(HOOK_BUDGET_MS, 5 × median)`, replacement PID, header currency, failure delivery, and once-only liveness assertions all remain.

On a calm reference below 400 ms, the 2,000 ms bound still catches a hook whose own timer, socket or daemon wait takes two seconds plus startup. This does not prove the absolute deadline on a saturated host. Moving the store to tmpfs also gives up detection of the hook's disk sync cost; the notes state that trade, subject to N3's wording correction below.

I agree with the coordinator's decision not to open a product row from this repair. D8 specifies WAL and `synchronous=NORMAL`; the evidence points at the host's storage stalls rather than an added hook wait or broken replacement. That is not evidence that physical disk latency always fits goal 6. Product store durability and hook implementation are unchanged, and this test-only review does not approve weakening either.

### N1: resolved

`tasks/001-320/notes.md:3` now distinguishes the test fixes from the handoff-slack product defect assigned to 001-326. It no longer claims no product defect was found.

### N2: resolved

`test/e2e/lifecycle.test.ts:40` says PreToolUse starts no daemon and changes no lifecycle state these cases assert. `tasks/001-320/notes.md:46` explicitly names idle-to-in-turn and told-regression writes, with the no-untold-regression condition in these fixtures. There is no general read-only claim left.

## Should-fix notes

### S1. Plausible: an existing `/dev/shm` need not support this complete fixture

**Location:** `test/e2e/harness.ts:130`, and the native-package copy in `#copyInstall` at `:200`.

The selection checks existence only. A Linux `/dev/shm` mounted `noexec` is a concrete portability risk: the complete cached Vitest/Vite install includes `@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node`, whose shared-library mapping can be refused on a `noexec` filesystem. The review host's tmpfs permits execution, so this is not a reproduced failure or a blocker. The required absent-directory fallback was exercised successfully.

**One-worker follow-up:** exercise a `noexec` tmpfs host and choose a usable tmpfs or keep executable fixture assets on disk while placing only the store on tmpfs. Preserve the same lifecycle assertions and explicit disk fallback. No production change is needed.

## Nits

### N3. Proven: the old check did measure disk cost, even though it was an unreliable proof

**Location:** `docs/specifications/001-core-loop/tasks/001-320/notes.md:71`.

The trade-off paragraph says “nothing here measured that before either, since the references paid the same syncs.” The previous check timed the whole target hook, including its disk cost, and rejected the recorded 4,428 ms sample; that is B1's evidence. The relative references could hide some stalls, so the old check did not reliably prove the disk budget, but it did measure and sometimes catch them.

**One-worker wording fix:** replace the last clause with “the old relative check was not a reliable proof of the disk budget, because the references could also stall.” Keep the explicit statement that tmpfs gives up this coverage. This is a note, not a reopened blocker.

## What fits

- The delta contains only two test files and the task notes. Product code, store policy, plugin bundles and budgets are unchanged.
- Both replacement and header cases retain their assertions for both harnesses. The candidate full run checks their daemon startup, Unix sockets, replacement and validation behavior with the actual tmpfs fixtures.
- The socket runtime remains a private short `/tmp/sq-*` path; moving the worktree lengthens no socket path. Store derivation follows the moved repository's `.git`.
- `E2E.create` removes both allocated directories if building fails. `e2eSuite` registers completed fixtures for `afterEach`, and `cleanup` removes base and runtime in `finally`. The scratch probe exercised both construction and body-failure paths with tmpfs, and the fallback fixture.
- No changed seam introduces a product interface or changes argument order or transaction expectations. Current headers and once-only delivery use the previously reviewed code and assertions.
- The earlier review's remaining settled findings are not re-prosecuted. The handoff-slack product row and bad-config diagnosis remain separate work.

## Inputs for the next wave

1. No B1 repair wave remains from this review. Keep `FixtureOptions.tmpfs` opt-in for the two budgeted dead-daemon cases, target first, then three PreToolUse references, and the unchanged formula and behavioral assertions.
2. Fold N3 into a notes-only edit if accepted. S1 is a Linux fixture-portability follow-up, not grounds to raise budgets or skip assertions under load.
3. Keep 001-337 responsible for the unchanged bad-config 45 s `daemonReady` timeout. Preserve every failure message and daemon/process evidence on recurrence; do not infer a cause from an isolated pass.
4. Full proofs must retain the four-worker cap, unset `CODEX_SESSION_ID`, disable global/system git config, and use an isolated HOME for all tools and children. Preserve raw timing/stress logs for future verification; distinguish reported historical runs from a fresh clean-candidate run.
