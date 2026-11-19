# Wave 16 review

**FAIL 4f1ac0c1f**. Two proven blockers. No should-fix items or nits.

Candidate: `cand/0.1.573`, full SHA `4f1ac0c1f9b9f0d8a3cdd8c3f1d881ec19620631`.
Range: `cda01acf4..4f1ac0c1f`. Reviewed rows 023-24 and 023-26, the
023-25 evidence and probes, and the final version and bundle commit.

## Verification

All executable checks below ran before the review file was added, at the exact
candidate on a clean tree. The extra probes lived outside the checkout and
imported the candidate's source and fixture helpers. They changed no product file.
Node `v26.13.0`, pnpm `12.15.0`, 24 CPUs. The observed one-minute host load
after the two required files ran was `31.29`, below the worker's reported 120.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `4f1ac0c1f9b9f0d8a3cdd8c3f1d881ec19620631` |
| `git status --short` | Empty before checks and before writing this file. |
| `pnpm run lint` | Exit 0. `Checked 3810 files in 2s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm run check:private` | Exit 0. `2616 added lines in 69 files ... ok`. Warning: `SQUEAL_PRIVATE_DENYLIST is empty`; that rule was skipped. |
| `git diff --check` | Exit 0, no output. |

The prepared dependency install was not repeated. No build, version raise or
local full suite ran, as the review brief requires.

Direct runs used `timeout 600` and `--maxWorkers=2`:

```sh
timeout 600 pnpm exec vitest run test/cli/status-wait-paused.test.ts test/runner-host/idle-host.test.ts --maxWorkers=2
```

Exit 0: **2 files, 3 tests passed**, 22.09 s.

```sh
timeout 600 pnpm exec vitest run test/cli/status-at-next.test.ts test/cli/status-at.test.ts test/cli/status-at-selection.test.ts test/cli/status-at-paths.test.ts test/cli/status-at-review13.test.ts test/cli/proof-report.test.ts test/cli/proof.test.ts test/cli/named-wait-starting.test.ts test/cli/named-partial-selection.test.ts test/cli/status-wait-folder.test.ts test/runners/boundaries.test.ts test/harness/shared/names-no-runner.test.ts --maxWorkers=2
```

Exit 0: **12 files, 80 tests passed**, 84.64 s.

```sh
timeout 600 pnpm exec vitest run test/cli/snapshot-selection-shrinks.test.ts --maxWorkers=2
```

Exit 0: **1 file, 4 tests passed**, 11.07 s. Total ordinary checks:
**15 files, 87 tests passed**.

Two outside-tree probes used
`timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs --root <scratch> --maxWorkers=2`.
Both assertions failed as described in B1 and B2. The first run used an
unsupported sync for B2 (10.23 s); the second used a pending sync (14.50 s).
The scratch config included only `probe.test.ts`. The probes and their fixture
repositories were removed after the review. All commands ended; no review job,
daemon or runner host was left running.

**Affected checks: unverified.** Ran
`~/.codex/plugins/data/squeal-hearsay/bin/squeal checks`, then
`~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000` with
`src/cli/{status-at.ts,status-at-next.ts,status-at-run-select.ts,proof-report.ts,proof-report-notes.ts,wait/named.ts,named-selection.ts,named-file-lines.ts,named-listing.ts}`
as separate arguments. The status exited 3 at revision 0:
`Named test files have no verdict: no daemon is running`.
The launcher used installed 0.1.570, not this candidate. Its result is not
candidate test evidence. This is why the relevant source tests ran directly.

**CI: pending, unverified.** `gh run list --commit <full candidate SHA>` and
`gh run view 44634638200 --json status,conclusion,jobs` showed
[candidate CI 44634638200](https://github.com/hearsay-tools/squeal/actions/runs/44634638200)
still `in_progress` at the last read. The test jobs and build evidence were not
complete. [Private material 44634638201](https://github.com/hearsay-tools/squeal/actions/runs/44634638201)
was `completed`, `success`. Pending CI is not a blocker in this judgment.

## Blockers

### 1. B1, proven: dirty submodules trigger the clean-HEAD refusal (Q2)

**Location:** `src/cli/status-at-next.ts:128` and `src/cli/status-at.ts:134`.
The new refusal relies on `readHead().dirty`. That existing helper calls
`git status` with `--ignore-submodules=all`
(`src/core/daemon-loop/head.ts:26`). It hides tracked changes inside a submodule.

**Contract:** the coordinator's Q2 decision keeps dirty trees working and refuses
only a clean tree without `--run`. The refusal also states that the tree is clean.

**Reproduction:** make a fixture with a committed local submodule, then edit a
tracked file in it. This body uses `fixture`, `git`, `run` and `testOf` from
`test/commit/at-keys-fixture.ts` and `test/cli/status-at-kit.ts`, plus `node:fs`
and `node:path` helpers:

```ts
const f = fixture({
  "src/a.ts": "export const value = 1;\n",
  "test/a.test.ts": testOf("a", 1),
});
const dep = join(f.dir, "dep");
mkdirSync(dep);
git(dep, "init", "-q", "-b", "main");
writeFileSync(join(dep, "source.ts"), "export const value = 1;\n");
git(dep, "add", "source.ts");
git(dep, "commit", "-qm", "initial");
git(f.root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", dep, "dep");
git(f.root, "commit", "-qam", "add dependency");
writeFileSync(join(f.root, "dep/source.ts"), "export const value = 2;\n");
expect(git(f.root, "status", "--porcelain")).toBe(" M dep\n");
const got = await run(f, { commit: "HEAD" });
expect(got.code).not.toBe(2);
```

**Actual:** Git reports ` M dep`. Both probe runs returned exit 2, empty stdout,
and this stderr:

```text
squeal status --at: HEAD is HEAD, your working tree's commit, and the tree is clean: compare with its parent, `squeal status --at HEAD~1`
```

**Expected:** continue the dirty-tree comparison. Never call this tree clean.
The new refusal makes an existing omission in the header's dirty flag reject a
previously allowed command.

**One-worker fix:** use a cleanliness check for this refusal that includes
submodule changes. Keep ordinary tracked edits and untracked files dirty, keep
ignored files excluded, and retain the no-keying refusal on a truly clean tree.
Do not change the daemon's shared HEAD rules without its owner's agreement.
Add this regression beside the Q2 tests.

### 2. B2, proven: an unlisted new test still gets a closure claim (Q7)

**Location:** `src/cli/named-listing.ts:50` and `src/cli/named-selection.ts:172`.
`listingOf` treats a store with existing keys and a refined latest stored revision
as fully listed. That does not prove that a newly created path was listed. The
watcher can still be recording its edit, and the wait's sync can still be pending.
In this state `selection.unlisted` is absent, so the new text guard does not run.

**Contract:** row 023-26 says, "Never a closure or selection statement about a
path it has not listed." The review brief also requires this before the daemon
lists a file. The selection's general partial-list warning does not make a
negative claim about that file valid.

**Reproduction:** use `repoWith`, `A` and `NOW` from
`test/cli/status-wait-fixture.ts`, `recordRefinedApplied` from
`src/core/scheduler/refined.ts`, `waitForNamed` from
`src/cli/status-wait-paths.ts`, and `namedText` from
`src/cli/status-wait-lines.ts`. This models a new test on disk before the daemon
records its next revision:

```ts
const { repo, store } = repoWith([], [A]);
recordRefinedApplied(store, repo.mainId, 4);
const path = "src/new.test.ts";
mkdirSync(join(repo.main, "src"));
writeFileSync(join(repo.main, path), "");
const got = await waitForNamed(repo.main, [path], {
  timeoutMs: 300, pollMs: 20, settleMs: 50, now: () => NOW,
  sync: () => ({ current: () => ({ state: "pending" }), stop: () => {} }),
  ask: async () => [], promote: () => {},
});
if (got.outcome === "unavailable") throw new Error("unavailable");
expect(namedText(got, NOW)).not.toContain("no test file's closure holds");
expect(got.outcome).toBe("timeout");
```

**Actual:** the pending-sync run ended at its deadline, measured 367 ms, but said:

```text
Selection: no test file yet; the list is partial while Squeal catches up with your latest edits
Named test files have no verdict: the deadline passed after 0.4 s: the daemon has not stored its pass over the edits made before the wait; results are as of revision 4; no test file's closure holds src/new.test.ts.
```

With `current: () => ({ state: "unsupported" })`, the same fixture returned
`unmatched` after about 103 ms, before the 300 ms deadline, and said
`No verdict: no test file's closure holds src/new.test.ts`.
Neither run listed or keyed `src/new.test.ts`.

**Expected:** report that the path is not listed yet. Continue waiting for its
listing, or end at the existing deadline with the wait-again step. State no
closure fact about it.

**One-worker fix:** let the path-level unlisted evidence reach `NamedSelection`
even when the latest stored revision is refined. The existing new-file check in
`src/cli/retry-unlisted.ts` already distinguishes a file created after the last
listing from a file no runner lists. Share that evidence or use an equally sound
listing record. Preserve listed-source lower bounds, folder kinds, prefix hints,
and the wait's deadline. Add both pending and unsupported sync regressions.

## What fits

- **Q1:** `nextProbe` and `--run` share `diffSelected`, `noResult` and `refuse`.
  Path narrowing reaches both through `commitSide`'s hooks. The fixture compares
  the hint count with the next real run's selection. Stored durations alone feed
  `estimateOf`; no stored duration gives `seconds: null`. The text distinguishes
  the diff selection from `--all-missing`, including an empty diff selection.
  JSON adds `next`, with `null` when absent. No hint appears with no runnable
  missing file, a failed or changed checkout, or an existing `--run`.
- **Q2, apart from B1:** clean HEAD and aliases exit 2 before the keyers or
  checkout open. A first commit gets the no-parent text. Ordinary dirty trees
  and `--run` still compare. The header and help explain the single comparison.
- **Q5/Q6:** the source-case note appears after red evidence only for a changed
  named test with a red outcome. `importsOf` supplies that distinction. The
  note is absent for unchanged tests, other cases and unknown outcomes. The new
  green-not-run text makes the limit clear. Proof JSON fields and values stay
  unchanged, including `greenNotRun` and control-run reasons.
- **Q7, covered states:** empty-store startup and a recorded but unrefined
  revision suppress closure and prefix text. The new tests cover a listing
  arriving before the deadline, timeout, no daemon and snapshots. The existing
  partial-selection tests preserve `at least` and `selection.complete: false`.
  The stored-walk tests preserve row 011-403's readers. Folder and prefix tests
  preserve row 011-406 once listed. These checks found no new hang.
- **Skill:** a script compared the full step-8 lines in `plugins/claude-code`,
  `plugins/codex-runtime` and `plugins/pi`: all three are identical and contain
  `(add \`--run\` for files with no result there)`. The clause is accurate.
  The pointer and frozen-seed copies have no step 8 and are unchanged, as the
  coordinator accepted in the worker notes.
- **023-25:** no keying fix is claimed. The notes report that seven setups did
  not reproduce the key split, retain the missing conditions, and name the next
  experiment. This does not establish that Q4 is fixed.

## The two loaded-host failures

Both named files passed directly on this candidate, including
`test/cli/status-wait-paused.test.ts:152`.

The paused-daemon file can exercise the changed named-wait code in its first
test. Its fixture already lists the named test, so the new unlisted guard does
not hold it. Line 152 starts the other test, the unnamed `status --wait` case;
its wait and socket cleanup code are unchanged. New CLI imports can affect
startup cost, but these assertions measure the tail after the first output.
The direct run did not reproduce the worker's failure.

`idle-host.test.ts` starts the daemon and node:test runner host directly. This
range changes no daemon, scheduler or runner-host idle code. It does not call
the changed CLI selection or reporting code. No changed runtime path explains
its failure; this run passed. A pass at lower load does not prove the earlier
failures were caused by load alone.

## Inputs for the fix wave

Dispatch B1 to the status-at owner and B2 to the named-wait owner. They can work
in separate CLI files. B1 must keep the refusal before keying and preserve the
`--run` exception. B2 must carry path-specific listing uncertainty through
selection, readiness and rendering, with the existing wait deadline unchanged.
Keep the passing listed cases above. No gate, key-format or store-schema change
is needed by either reproduction. Exact-candidate full CI and bundle-build
evidence remain pending; this review ran neither locally.
