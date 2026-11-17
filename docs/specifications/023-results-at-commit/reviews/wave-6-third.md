# Wave 6 third review: PASS

Candidate: `cand/0.1.548`, exactly `0a792343b44f0cd1931ab630dcae016f557e41fd`.
Verdict: **PASS — no blockers, should-fix items or nits in this bounded review. B5 is closed.**

Scope: the remaining B5 project-identity finding in `wave-6-rereview.md`, the removal of the named-file shortcut, and regressions from that change. B1–B4 stay closed. The human dropped the shortcut on 2026-11-17. Unrelated changes already on main 0.1.546 are outside this review.

## Verification output

Candidate checks and external probes ran at the exact SHA above with a clean tracked tree. The external probe and config were outside the repository and were removed before committing. This report is the only file committed by this review.

- `git fetch origin`; `git checkout --detach 0a792343b44f0cd1931ab630dcae016f557e41fd`; `git rev-parse HEAD` → the requested SHA.
- Fetched `origin/main` and merge base: `feaa73277c8ebe9a1d51f63653ef7e9a67f3d9f9`. The scoped repair is `3b3b3f852`, notes `8c1fe4b83`, and version/bundle commit `0a792343b`. The rest of the wave was rebased onto main.
- Dependencies were already installed by Squawk. No separate install command was run.
- `pnpm run lint` → exit 0, `Checked 3653 files in 1700ms. No fixes applied.`
- `pnpm run typecheck` → exit 0 (`tsrs --fast --noEmit`). pnpm also reported the lockfile up to date and dependencies already up to date.
- `pnpm run build` → exit 0, including all four harness builds. `git status --porcelain` stayed empty; the 0.1.548 committed bundles have no drift.
- `git diff --check` → exit 0, no output.
- `git diff --quiet d7ed84184 HEAD -- src/core/commit src/cli/status-at-now.ts src/cli/status-at-report.ts` → exit 0. The core CI proofs and current-side/report logic are unchanged from the preceding candidate.
- `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/cli/status-at-selection.test.ts test/cli/status-at-fixture.test.ts test/cli/status-at.test.ts test/commit/at-keys-ci.test.ts test/commit/at-keys-ci-proof.test.ts test/keys/key-format.test.ts test/version-sensitive.test.ts` → exit 0 at revision 10, **7 files, each with a current result**, no known failures, after 50.4 s. Wider worktree: **861 not current, all queued**. Those wider results remain unverified. The launcher reported that this session keeps Squeal 0.1.542 while installed plugins are 0.1.546; the checks read the candidate's current test/source files.
- External probe command: `timeout 600 pnpm exec vitest run --config /tmp/squeal-review-023-wave6t-889b2c13/vitest.config.mts --maxWorkers=1` → **1 file passed, 2 tests passed**, 3.81 s. The tests check the exact B5 counterexample and the selected CI-pass control below.
- Exact-candidate CI at the check: [Private material](https://github.com/hearsay-tools/squeal/actions/runs/44148671966) **success**; [CI](https://github.com/hearsay-tools/squeal/actions/runs/44148672252) **in progress**. Full-suite CI remains unverified. No local full suite or full-suite checkpoint was requested.
- `pnpm run check:private` before this report commit → exit 0, `private: 11012 added lines in 59 files over feaa73277c8ebe9a1d51f63653ef7e9a67f3d9f9, ok`. It warned that `SQUEAL_PRIVATE_DENYLIST` is empty, so that rule was skipped. The command checks committed changes and is repeated after the report commit to include this file.

## B5 closure and regression checks

**B5 — closed, verified by the original counterexample.** At the first fixture commit, `test/a.test.ts` belongs to Vitest project `unit`. At HEAD, the same file and source remain, but the config lists the test in the default project. Asking for the filename and asking for its folder now both return:

```text
("", "test/a.test.ts")
("unit", "test/a.test.ts")
```

The `unit` entry has its actual commit-side key in both reports, the keys are equal, and its state is `no result`. Both calls exit 3. The default project's commit side remains not determined because that project did not list the file there. No checkout is left behind.

The repair removes the caller's `named` branch. `CommitSideOptions` omits `files`; with paths, `commitSide` always narrows the checkout adapters' listing and lets that listing establish the commit's project/path refs. The union with today's refs therefore retains both identities. Narrowing changes the listing, not the adapter's closure/keying method.

**CI control — passed.** A real-adapter fixture records the local environment and publishes an export with passes for `test/a.test.ts` and `test/plain.test.ts`. A CLI call selecting only `test/a.test.ts` still reports its commit side as `pass` with origin kind `ci`, and reports exactly that one file. The unrelated export is filtered out. The checkout time is present, the checkout has no failure, and cleanup leaves no checkout. Thus the removal of the CLI shortcut preserves CI result use inside `keysAtCommit` while using the checkout to establish the listing.

**B1–B4 remain closed.** Their core proof code is unchanged. Their relevant regression tests, the CLI fixture tests, and the version/key-format tests are current in Squeal. The previous review's settled text, JSON, retention, daemon/no-daemon and real fail-to-pass conclusions were not re-prosecuted.

## Inputs for the next wave

No repair is required by this review. Keep selection based on each version's own listing and union by project and path. CI may supply a selected file's result after the environment, observed-input, key and source proofs; it does not establish the complete project listing by itself. Row 023-07 can build on these contracts. Release still requires passing full-suite CI for the exact release commit under the repository's release rule.
