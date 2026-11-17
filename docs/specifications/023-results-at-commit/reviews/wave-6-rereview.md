# Wave 6 re-review: FAIL

Candidate: `cand/0.1.547`, exactly `d7ed84184fd48df23a569c8f7cb91976ec38edda`.
Scope: B1–B5 from `wave-6.md` at review commit `23aa3fd930f66893f9979fc9627474f4a34e07a3`, and their repair delta from `cf4357e2a349ce800e0e4a6a068c633c88a7a637`.
Verdict: **FAIL — one proven blocker remains (B5); B1–B4 are closed. No separate should-fix items or nits.**

## Blocker

### B5 — proven, partly repaired: an explicit filename still loses its commit-side project identity

Location: `src/cli/status-at.ts:120` and `src/cli/status-at.ts:128`; `src/cli/status-at-commit.ts:45`.

The prior B5 fix scope requires expansion against each side's listing, comparison of their union, and retention of project identity. It explicitly includes a file listed under a named project only at the commit. D1 and D3 require the selected file's state at the commit and now.

The new `named` shortcut uses today's project refs whenever every path exactly names a current test file. `commitSide` then passes those refs through without discovering the commit's own projects. A test whose path stays equal but whose project changes is still omitted under its old project. The successful checkout does not repair this: it is asked to key only the current project ref.

Reproduction with the real Vitest adapter and no daemon:

1. Use the existing `fixture` helper with `test/a.test.ts`, its `src/a.ts` import, and this committed `vitest.config.mjs`:

   ```js
   export default { test: { projects: [{ test: { name: "unit", include: ["test/*.test.ts"] } }] } };
   ```

2. Record that commit as `before`. Keep the test and source unchanged. Commit this config at HEAD:

   ```js
   export default { test: { include: ["test/*.test.ts"] } };
   ```

3. Call `statusAtCommand` at `before`, with JSON, `cacheRoot: f.cacheRoot`, and `install: keying(f).install`. Compare `paths: ["test/a.test.ts"]` with `paths: ["test"]`.

Actual output at the same commit and HEAD:

| Selection | Reported `(project, path)` refs | Commit-side result |
| --- | --- | --- |
| Explicit filename | `("", "test/a.test.ts")` only | `not determined`, `unlisted: no runner in the checkout keyed test/a.test.ts` |
| Folder | `("", "test/a.test.ts")` and `("unit", "test/a.test.ts")` | The `unit` ref has its actual commit key, state `no result` |

Both calls exit 3, but the filename report loses the selected test's actual commit-side identity and key. It counts one unknown instead of two. The folder report gives the `unit` key `04c0d22680aa0cc24dd41a2c52c66511a1dc22271e46a0b13e379636161bbc45`; the filename report never asks for it. An assertion that both selections report the same refs fails. This is the project-identity part of B5, not a new review topic.

Fix scope: one CLI worker. Obtain or prove the commit-side project refs for explicit filenames too, then compare the union with today's refs. If the named-file CI shortcut stays, it needs proof that it cannot omit another commit-side project. Add this same-path project-change regression beside the existing deleted named-project fixture. Keep the existing named-file CI behavior when its identity is proved, the read-only contract, and the path narrowing.

## Verification output

All candidate checks and probes below ran with HEAD exactly `d7ed84184fd48df23a569c8f7cb91976ec38edda` and a clean tracked tree. Probe files were outside the repository. The review changes no product file and commits this report alone.

- `git fetch origin`; `git checkout --detach d7ed84184fd48df23a569c8f7cb91976ec38edda`; `git rev-parse HEAD` → the requested SHA.
- `git log --oneline cf4357e2a..HEAD` → repair commits `7a17dde2a`, `013485e75`, `35022b80c`, `720193a72`, and bundle commit `d7ed84184`.
- Dependencies were already installed by Squawk; installation was not repeated.
- `pnpm run lint` → exit 0, `Checked 3650 files in 1626ms. No fixes applied.`
- `pnpm run typecheck` → exit 0 (`tsrs --fast --noEmit`).
- `pnpm run build` → exit 0, including all four harness builds; `git status --porcelain` remained empty. No committed bundle drift.
- `git diff --check` → exit 0, no output.
- `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/commit/at-keys-ci.test.ts test/commit/at-keys-ci-proof.test.ts test/cli/status-at.test.ts test/cli/status-at-fixture.test.ts test/cli/status-at-selection.test.ts test/keys/key-format.test.ts test/version-sensitive.test.ts` → exit 0 at revision 5, **7 files, each with a current result**, no known failures, after 53.0 s. Wider worktree: **445 not current (4 running, 279 queued, 162 unknown)**. Those wider results are unverified; no full suite was requested.
- External probe command: `timeout 600 pnpm exec vitest run --config /tmp/squeal-review-023-wave6r-889b2c13/vitest.config.mts --maxWorkers=1` → **5 passed, 1 failed**, 5.98 s. The five passes reproduce the original B1–B5 cases. The single assertion failure is the B5 project-identity case above. The external probe files are removed before commit.
- Exact-candidate CI: [Private material](https://github.com/hearsay-tools/squeal/actions/runs/44133898456) **success**; [CI](https://github.com/hearsay-tools/squeal/actions/runs/44133898183) **in progress** at the check. Full-suite CI remains unverified.
- `pnpm run check:private` before committing → exit 0, `private: 10995 added lines in 59 files over bcb54db8d33b7e04c80dfc2fcc9b373461f4fa92, ok`. It warned that `SQUEAL_PRIVATE_DENYLIST` is empty, so that rule was skipped. The command checks committed changes and is also repeated after the report commit to include this file.

## What the repairs close

| Prior finding | Result at this candidate | Evidence |
| --- | --- | --- |
| B1: shared observations change the checkout key | Closed | Original probe now falls back and equals `ci: false`. `sameObserved` checks the three per-file maps and project start-up entries. The committed regression also proves an equal observed set can still use CI at the checkout key. |
| B2: changed allow-listed variable uses a stale environment | Closed | Original probe now falls back and equals `ci: false`. `options.env` reaches the proof, which reads the commit's own allowlist and compares the current variable hash/names and process Node/platform/arch with the recorded descriptor before applying 018 D10. |
| B3: local export receives a CI origin | Closed | Original probe settles zero files and returns no CI-marked record. The reader refuses a bundle whose recorded source is not `github`. |
| B4: failed all-file checkout exits 0 | Closed | Original empty-current-listing probe now exits 3 with the install failure. The exit decision checks `at.failure` independently of file counts. `commitSide.state` uses the commit tree to distinguish absence from failed keying. |
| B5: folder omits deleted tests | Original case closed; project identity still incomplete | Original partly deleted folder probe now includes the deleted test with `now: absent` and exits 3. Committed tests also cover an old-only folder and a deleted named-project test. The same-path explicit filename variant above still fails. |

The previous review's settled text, JSON, retention, daemon/no-daemon, origin handoff and real fail-to-pass fixture conclusions were not re-prosecuted. Their relevant committed tests are current in Squeal. The repair keeps the CI path read-only and its existing network policy; the new policy read uses a temporary directory and removes it in `finally`.

## Inputs for the next repair

Only B5 remains blocking in this bounded re-review. Repair the explicit filename selection and add the project-change fixture. Verify both filename and folder forms return the same project/path union. Re-run the focused selection tests and the CI named-file controls so the repair does not silently disable valid CI hits or change key/origin handling. Keep `timeout 600`, affected checks, and no local full suite.
