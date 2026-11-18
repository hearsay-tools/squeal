# Wave 8 re-review: project evidence, HEAD inputs and copied links

FAIL ee6617c6cd008fb08f4853ec842bf2599b9b56cd

Two proven blockers remain in B1 and B2. B3 is closed. The original import-error and dirty-config reproductions pass, but the repairs still permit another project's failure text and a false committed-HEAD green pass.

Scope: `reviews/wave-8.md` B1–B3, repair `8535522cd` (pick of `26e81c18a`), its changed callers, notes `ae7f82d48` and rebuilt candidate `cand/0.1.560`. This candidate rebases the five original 023-08 commits onto main 0.1.559 (`5b9e4b019dbbf2a18a56fe356be666d8611e0051`). The unrelated main changes are outside this bounded review. No product code was edited.

## Verification

The checks and five independent probe jobs ran on the exact candidate with a clean tree, before this report was added. The existing dependency setup was retained. The `pnpm run typecheck` invocation itself reported a lockfile policy check and `Already up to date` in 88 ms; no separate setup command was run.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin && git checkout --detach ee6617c6cd008fb08f4853ec842bf2599b9b56cd`; `git rev-parse HEAD`; `git status --short` | Exact requested candidate; clean tree. |
| `pnpm run lint` | Exit 0: `Checked 3706 files in 1575ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0; four plugin builds completed; no drift. |
| `pnpm run check:version origin/main HEAD` | Exit 0: `0.1.559 -> 0.1.560, ok`; adapter `1.0.3 -> 1.0.3, ok`. |
| `pnpm run check:private` | Exit 0: `39742 added lines in 67 files ... ok`. Warning: private denylist empty, so that rule was skipped. This reads committed HEAD; it is repeated after the findings-only commit to include this report. |
| First focused Squeal wait below | Exit 3 after 60.7 s at revision 5: six current passes, seven pending. |
| Repeated focused Squeal wait | Exit 0 after 2.0 s at revision 5: all 13 named files current, no known failures. Whole worktree still had 834 files not current: 190 running, 643 queued, one unknown. This is focused evidence, not a full-suite pass. |
| Affected-source wait | Exit 3 after 60.7 s at revision 5: 308 selected files, 45 current passes and 263 pending. No known failures. It named `proof-side.ts`, `proof.ts`, `proof-report.ts`, `at-keys-side.ts`, `at-keys-checkout.ts`, `status-at-now.ts` and `status-at-run-outcome.ts` by their full source paths. |
| Final `squeal status --wait 60000`, with only this report added | Exit 0 but returned on timeout after 60.6 s at revision 7: 537 affected files pending; whole worktree had 538 files not current (128 running, 409 queued, one unknown), no known failures. This is incomplete evidence and unverified as a clean-candidate gate because the report was present. |
| Independent probes | Five `NODE_ENV=test timeout 600 pnpm exec tsx "$TMPDIR/rereview.mts" <case>` jobs exited 0. Real Git, real Vitest, source CLI child. Cases: projects, dirty config, links, status and installed dependencies. Details below. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44214724208) | In progress at the last read. No full-suite conclusion is claimed. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44214724237) | Completed successfully for this exact candidate. |

The focused wait used the session's absolute launcher, shown with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/proof-review.test.ts test/cli/proof.test.ts \
  test/cli/proof-copy.test.ts test/cli/proof-killed.test.ts \
  test/cli/status-at.test.ts test/cli/status-at-run.test.ts \
  test/cli/status-at-run-review.test.ts test/cli/status-at-run-env.test.ts \
  test/cli/status-at-run-inputs.test.ts test/commit/at-keys.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts \
  test/harness/shared/names-no-runner.test.ts
```

All probe repositories lived under `$TMPDIR`, outside this worktree. Each proof and gate had a 600-second budget. The ordinary install linked this checkout's Vitest, as the existing integration fixtures do. The dependency probe additionally used real pnpm installs of committed local packages, offline, with scripts disabled; its side installs used `--frozen-lockfile`. Every fixture checked that only its main Git worktree remained, then removed its directory. All five jobs ended, with no probe process or fixture left. The temporary script was removed before committing. No local full suite ran.

## B1 disposition: verdict classification repaired, failure evidence still crosses projects

The original two-project fixture now returns **3** on both calls. Project `assert` reads `proven`; project `import` reads `red for another reason` with its actual missing-module error. The first call runs three file/project sides; reuse runs none. Stored failures are now read through `resultsAt` at the correct project, path and key.

With coverage off, the same assertion/import pair now returns `not comparable` for both projects on both calls, with the reason that their failures differ and no stored result identifies the project. This is a correct conservative refusal. Two projects with identical assertion failures still return `proven`, with `stored: false`.

### B1 remaining blocker: proven false failure text when unstored projects have the same error kind

**Location:** `src/cli/proof-side.ts:216`–`:223` and `:252`–`:258`.

**Contract:** D5.5 requires the report to carry the red side's failed tests and their failure text for each file. The original B1 fix requires a project's evidence to belong to that project, or an honest refusal when the command cannot distinguish it.

**Variant:** Keep the same two projects (`MODE=assert` and `MODE=import`), base source `value = 1`, HEAD source `value = 2`, and coverage off. Both projects run the same named test:

```ts
it("value", () => {
  if (value === 1) expect(process.env.MODE).toBe("fixed");
  expect(value).toBe(2);
});
```

Both red projects fail assertions and both green projects pass. The correct red text differs: `expected 'assert' to be 'fixed'` versus `expected 'import' to be 'fixed'`.

**Observed:** Exit **0**, `runs: 4`, both files `proven`, both red sides unstored. Both red reports contain **`expected 'assert' to be 'fixed'`**. Project `import` receives the other project's error message, diff and error record. This remaining case does not misclassify an import error as an assertion; it still supplies false project-specific evidence in the report.

`sharedFailures` compares only test names and error kinds, then returns `first.failed`. Equal kinds prove the same verdict category; they do not prove equal failure evidence. This is the changed B1 join, not an unrelated new concern.

**One-worker fix:** Preserve project identity in unstored failure evidence. A conservative alternative is to reuse a path's failure payload only when the complete evidence shown in the report agrees across projects; otherwise refuse or represent the ambiguity. Comparing error kinds alone is insufficient. Add this same-kind/different-message fixture with coverage off and with storage disabled by a changed checkout. Require each project's own message or an explicit refusal. Keep the passing stored and mixed-kind cases above.

## B2 disposition: Git-visible dirt repaired, installed-dependency residual is blocking

The original uncommitted Vitest-config fixture now returns **1**, `not green`, with `dirty: ["vitest.config.mjs"]`. Green runs in a HEAD checkout and fails under committed `WANTED="9"`. Staging the config change still returns `not green`, now reusing the committed checkout's stored failure. Restoring the committed config leaves the same verdict. The broadened Git-visible check closes the original reproduction.

### B2 remaining blocker: proven false `proven` with clean Git and a different installed dependency

**Location:** `src/cli/proof.ts:58`, `:62`, `:85` and `:236`–`:241`.

**Contract:** D5's green side is the test and code at HEAD. The original B2 requires agreement for all key inputs before a current-side pass represents committed HEAD, including dependencies. The worker notes disclose the installed-dependency residual; they do not make a false green result a conservative refusal.

**Fixture:** Commit two local dependency packages. Both are named `proof-dep`; `vendor/one` is version 1.0.0 and exports `dependency = 9`; `vendor/two` is version 2.0.0 and exports 2. The committed root manifest depends on `file:vendor/one`. Generate and commit its real pnpm lockfile. The test imports `value` from `src/a` and `dependency` from `proof-dep`, then asserts `value === 2` and `dependency === 2`. Base exports source value 1; HEAD changes only that source to 2. Both commits keep the dependency on `vendor/one`.

Create the differing installed state with real pnpm, then restore only Git-held inputs:

```sh
pnpm --ignore-workspace add proof-dep@file:vendor/two --offline --ignore-scripts
git restore package.json pnpm-lock.yaml
git status --porcelain
```

The status is empty. The installed package and hidden installed lockfile still describe `vendor/two`; the committed manifest and lockfile describe `vendor/one`. Seed a real passing gate result in that working tree. The probe's checkout install runs `pnpm --ignore-workspace install --offline --ignore-scripts --frozen-lockfile`, then links Vitest.

**Observed:** Proof returns **0**, `proven`, `dirty: []`, `runs: 1`. Red fails the source assertion at base; green is a **pass from the current store**. Now run the same frozen install in the working tree, without changing any commit, manifest, lockfile or test, and repeat. Proof returns **1**, `not green`, `dirty: []`, `runs: 1`; green runs and fails **`expected 9 to be 2`**.

The commits in both calls were base `35e5a81650938e00851731be5e0b24aeb528c787` and HEAD `cfb0f261adf1a3c07ce951d890edbf96961515d3`. The Git tree was clean for both. This uses valid pnpm installs and distinct package versions, not modified package bytes under an unchanged installed fingerprint. The stored pass belongs to the actual version-2 environment; the command has no basis to call it committed HEAD's version-1 green. No shared-key corruption is claimed.

**Judgment of the stated residual:** blocking, proven. It yields a successful proof for a HEAD whose committed dependency installation fails the test. Printing this limit in worker notes does not meet the original B2 contract or D5's side definition.

**One-worker fix:** Establish the HEAD side's actual key in its frozen-installed checkout before accepting a current stored result, then read the store at that key. This can still avoid a test run and preserve store-first behavior. An equally sound installed-environment comparison is acceptable, but Git cleanliness alone cannot establish it. Add this real-pnpm fixture and require `not green` in both installed states. Do not force a rerun of every known side merely to avoid checking its key.

## B3 disposition: closed

Every copied committed link now enters `expected`, and preparation restores its symlink kind and target. Independent variants agree with the repair:

| Red checkout install | First and repeated proof |
| --- | --- |
| Replace copied link with regular JSON 3 | `proven`; red runs each time, `stored: false`, reason names `test/helpers/wanted.json`. |
| Retarget link to tracked `3.json` | Same storage refusal and repeated run. |
| Retarget link to an absolute file outside the repository | Same storage refusal and repeated run. |
| Delete link | `red for another reason`, exit 3; red runs each time, `stored: false`, reason names the deleted link. |
| Honest link to `2.json` | `proven`; first call stores the red failure and green pass; second call has `runs: 0` and both sides from the store. |

No copied-link storage bypass remains in these cases. Preserve this single expected-tree verifier.

## Shared `resultsAt` seam: no regression found

The shared reader retains the previous project/path filter in `found`, `status-at-now` and `status-at-run-outcome`. A separate real fixture gives two projects of one path opposite results at base. `status --at <base> --run --all-missing` reports and stores one pass for `assert` and one fail for `import`; selected, ran and stored are each 2. A later lookup without `--run` keeps those exact outcomes. Exit 3 is correct while the current side lacks results. After keying/running at that same base in the working tree, `status --at <base>` returns 0 and shows the same pass/fail pair at both sides, `unchanged: 2`. The 13 focused passing files also cover the shared reader's status, checkout and run callers.

## Should-fix and verification limits

- **Proven, nonblocking count issue in the B1 repair:** the coverage-off assertion/import refusal reports `runs: 0` even though both red projects executed. The refusal drops the run's provenance when it returns `unknown`, and the counter only counts `from: "run"`. Preserve the fact that execution happened while refusing to attribute its evidence.
- Broad affected coverage and exact-candidate CI remain incomplete. Neither is a new blocker. No full-suite pass is claimed.

## Inputs for the next repair

Keep B3 and the original B1/B2 reproductions closed. Fix B1's unstored evidence ownership and B2's committed-HEAD key validation. Keep store-first reuse, the shared result reader, process cleanup and the single deadline. Use the variants above as focused regressions. Conditions and repeat remain row 023-11's work. No local full suite is needed for this review; exact-release CI remains a separate release gate.
