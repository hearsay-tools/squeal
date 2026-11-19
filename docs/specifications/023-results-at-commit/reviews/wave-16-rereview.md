# Wave 16 re-review

**FAIL c80c030df**. One proven blocker: B2 remains for valid in-tree names
beginning with two dots. B1 is closed. The original spelling of B2 is fixed.
Two requested limits are assessed below as nonblocking notes. No nits.

Candidate: `cand/0.1.573`, full SHA
`c80c030dfe811f5d9e40796a38a00f70d6ff5402`.
This is a bounded re-review of `wave-16.md` (review commit `2aefe3932`).
The delta from `4f1ac0c1f` contains repair commits `3c6064b69`, `2a7641563`
and the final rebuilt bundles. These are the candidate's copies of the two
worker repair commits named in the brief.

## Verification

Fetched `cand/0.1.573` and checked out the exact candidate on this review branch.
All executable checks ran with clean candidate files, before this report was
added. Independent probes lived outside the worktree and imported this candidate.
Dependencies were already installed. No install, build, full suite or version
raise ran.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `c80c030dfe811f5d9e40796a38a00f70d6ff5402` |
| `git status --short` | Empty before checks and before writing the report. |
| `pnpm run lint` | Exit 0. `Checked 3804 files in 1860ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm run check:private` | Exit 0. `5157 added lines in 70 files ... ok`. The private denylist rule was skipped because `SQUEAL_PRIVATE_DENYLIST` was empty. |
| `git diff --check` | Exit 0, no output. |

```sh
timeout 600 pnpm exec vitest run test/cli/status-at-next.test.ts test/cli/named-wait-starting.test.ts test/cli/named-partial-selection.test.ts test/cli/status-wait-folder.test.ts test/cli/snapshot-selection-shrinks.test.ts --maxWorkers=2
```

Exit 0: **5 files, 37 tests passed**, 19.91 s. This includes the worker's B1
and B2 regressions and the listed cases for rows 011-401, 011-403 and 011-406.
The observed one-minute host load after this run was `25.57` on 24 CPUs.

Independent probes used:

```sh
timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs --root <scratch> --maxWorkers=2
```

The scratch config included only `probe.test.ts`. Initial result: **4 passed,
1 failed**, 6.84 s. The passes cover B1 and its tracked/untracked/clean controls,
B2 with pending sync, B2 with unsupported sync, and the ignored-file deadline
limit. The failure is B2's valid-name variant below. A follow-up bounded to
`-t 'two dots'` ran that variant in both sync modes: **2 failed, 4 skipped**,
5.86 s. No product file changed for these probes. Scratch files and fixture
repositories were removed. All review commands ended; nothing was left running.

**Affected checks: unverified.** Ran
`~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000`
with `src/cli/status-at-next.ts`, `src/cli/named-listing.ts`,
`src/cli/named-selection.ts`, and `src/cli/named-file-lines.ts`.
It exited 3 at revision 0: `Named test files have no verdict: no daemon is running`.
The launcher used installed 0.1.570, not the candidate. Direct source checks
provide the evidence above.

**CI: pending, unverified.** `gh run list --commit <full candidate SHA>` last
reported [CI 44637692746](https://github.com/hearsay-tools/squeal/actions/runs/44637692746)
as `in_progress`. Exact-candidate full test and build results were not complete.
[Private material 44637693044](https://github.com/hearsay-tools/squeal/actions/runs/44637693044)
was `completed`, `success`. Pending CI is not a finding against this wave.

## Previous blockers

- **B1 closed, proven.** The original submodule reproduction now compares rather
  than refusing. The independent probe also checks a clean submodule, an ordinary
  tracked edit, an untracked file, and a moved submodule commit. The candidate's
  regression covers the submodule edit and move. `headRefusal` now uses its own
  `--ignore-submodules=none` status. A Git failure cannot yield a clean refusal.
  The caller still skips this guard for `--run`, and the guard remains before
  keying. The unchanged report header has a narrower dirty flag; see N1.
- **B2 original reproduction fixed, proven.** The new `src/new.test.ts` gets
  `Squeal has not listed src/new.test.ts here yet` with pending and unsupported
  sync. Both waits end at the deadline. The candidate's regressions also cover a
  second unmatched path and the new file becoming listed before the deadline.
  The new path guard still drops another valid spelling of the same scenario.

## Blocker

### 1. B2 remains, proven: two-dot filenames bypass the unlisted guard

**Location:** `src/cli/named-listing.ts:97`, added in this repair.

```ts
const inside = (p: UnmatchedPath) =>
  !isAbsolute(p.resolved) && !p.resolved.startsWith("..");
```

`..new.test.ts` is a file in the worktree root. It is not a parent-directory
path. `worktreePath` already makes that distinction correctly. The new filter
rejects this valid relative name, so the file never reaches `newToListing`.
`selection.unlisted` stays absent and the same closure claim as B2 returns.

**Contract:** row 023-26: "Never a closure or selection statement about a path
it has not listed." This is the existing B2 scenario with a different valid
filename, reopened by the repair's own path filter.

**Reproduction:** use the exact fixture and wait from the first review's B2,
replacing `src/new.test.ts` with `..new.test.ts`. The test body below uses
`repoWith`, `A` and `NOW` from `test/cli/status-wait-fixture.ts`,
`recordRefinedApplied` from `src/core/scheduler/refined.ts`, `waitForNamed`
from `src/cli/status-wait-paths.ts`, and `namedText` from
`src/cli/status-wait-lines.ts`:

```ts
const { repo, store } = repoWith([], [A]);
recordRefinedApplied(store, repo.mainId, 4);
const path = "..new.test.ts";
writeFileSync(join(repo.main, path), "");
const got = await waitForNamed(repo.main, [path], {
  timeoutMs: 300, pollMs: 20, settleMs: 50, now: () => NOW,
  sync: () => ({ current: () => ({ state: "pending" }), stop: () => {} }),
  ask: async () => [], promote: () => {},
});
if (got.outcome === "unavailable") throw new Error("unavailable");
expect(namedText(got, NOW)).not.toContain("no test file's closure holds ..new.test.ts");
expect(got.outcome).toBe("timeout");
```

**Actual, pending sync:** timeout after a measured 319 ms, with:

```text
Named test files have no verdict: the deadline passed after 0.3 s: the daemon has not stored its pass over the edits made before the wait; results are as of revision 4; no test file's closure holds ..new.test.ts.
```

**Actual, unsupported sync:** replacing `pending` with `unsupported` returns
`unmatched` after a measured 77 ms, before the 300 ms deadline, with:

```text
No verdict: no test file's closure holds ..new.test.ts. Worktree: known failures 0; all 1 test file current
```

No revision or key lists the new file in either case.

**Expected:** the same unlisted text and deadline behavior as `src/new.test.ts`.
Neither the file's name nor the partial-selection warning permits a closure fact.

**One-worker fix:** reject the parent path segment (`..` and `../...`), rather
than every name starting with two dots. Reuse the worktree path rules if possible.
Keep actual outside-root paths excluded. Add both sync-mode regressions for
`..new.test.ts`, with an outside-root control. No store or key-format change
is needed.

## Requested limits and nonblocking notes

### N1. Proven, pre-existing: header and refusal use different dirty definitions

The independent submodule probe now passes the refusal guard and produces a
comparison whose JSON has `dirty: false`. It also confirms that `readHead` still
returns `dirty: false` for that tracked submodule edit. The text header omits its
`, dirty` marker. It does not print the former false sentence `the tree is clean`.

This is an existing header limit. The repair deliberately leaves `readHead` and
the report header unchanged. Neither comparison keying nor result lookup uses
this dirty flag as evidence that the two sides are equal. B1's rejection is fixed.
This mismatch is a note for the shared HEAD/header owner, not a new blocker in
this bounded repair. A future change should either align the meanings or explain
the header flag's narrower scope.

### N2. Proven, nonblocking: a newly edited ignored file waits to the deadline

The probe creates `src/ignored.ts`, names it in `.gitignore`, and uses the same
refined revision-4 fixture with unsupported sync. Its wait returns `timeout` and
prints `Squeal has not listed src/ignored.ts here yet`. It states no closure fact.

`newToListing` uses file time rather than Git's ignored-file rules. An ignored
edit may record no new revision, so repeating the wait need not make progress.
Each wait remains bounded by its deadline. This is the conservative limit named
in the re-review brief. It affects latency and the value of the wait-again hint;
it does not create a new hang or a false result. It does not block this repair.

## What fits and inputs for the next repair

Rows 011-401 and 011-403 retain lower-bound wording, `selection.complete`, and
the stored-walk fallback. The folder and prefix cases of 011-406 pass. Its edited
fixture now records a start-scan marker after the file's creation, so it exercises
the listed-file control; the new-file tests exercise the other side. Folder
selection and prefix rendering themselves are unchanged by that fixture edit.

The Q1 and proof-report behavior settled by the first review is unchanged.
No need to re-prosecute it. The two prior loaded-host files were not rerun in
this bounded re-review; their recorded passes apply to `4f1ac0c1f`, not this SHA.

Dispatch only the B2 path-filter correction and its controls. Preserve B1's
separate refusal check, the listed cases above, and the existing wait deadline.
Exact-candidate full CI and bundle-build evidence remain pending.
