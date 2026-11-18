# Wave 8 review: `squeal proof`

FAIL c03d789f5f9abf009fdb574daefcfa74150ac059

Three proven blockers. No product code was changed. Scope: row 023-08, candidate `cand/0.1.558`, range `be511fef11c012ce2e0a3baf5aac19a069be43dc..c03d789f5f9abf009fdb574daefcfa74150ac059`. The six commits add the command, tests, notes, and versioned bundles. This is a new-wave review against D5.1, D5.2, D5.5, D5.6 and amended D2. The wave-7 reviews supply the storage invariant; their settled findings are not reopened outside changed boundaries.

## Verification

Checks and independent probes ran at the exact candidate on a clean tree, before this report was added. Dependency installation was supplied by Squawk (`pnpm install --frozen-lockfile`, reported 0 s), and was not repeated, as requested.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD`; `git status --short` | Exact requested candidate; clean tree. |
| `pnpm run lint` | Exit 0: `Checked 3704 files in 1519ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no drift. |
| `pnpm run check:version be511fef11c012ce2e0a3baf5aac19a069be43dc c03d789f5f9abf009fdb574daefcfa74150ac059` | Exit 0: `0.1.557 -> 0.1.558, ok`; adapter `1.0.3 -> 1.0.3, ok`. |
| `pnpm run check:private` | Exit 0: `38727 added lines in 64 files ... ok`. Warning: private denylist empty, so that rule was skipped. This check reads committed HEAD; the report is checked again after its docs-only commit. |
| Focused Squeal wait below | Exit 0 at revision 0, after 36.3 s: all nine named test files have current results; no known failures. Includes the proof command, copy, killed-run, parser, sides, verdict, key-format and both boundary checks. |
| Affected-source Squeal wait below | Exit 3 at revision 0: 309 selected files, 141 current passes and 168 unknown. Of the unknown files, 149 had nothing queued and 19 waited for the parent's run of their key. This is incomplete coverage. |
| Final `squeal status --wait 60000` on the clean candidate | Exit 0, returned on quiet at revision 0 after 2.0 s. No known failures; 511 of 1968 test files not current, all unknown; 0 running, 0 queued. No completed full-suite checkpoint. This does not verify the unknown files. |
| Supplemental final wait with only this report added | Exit 0, returned on quiet at revision 1 after 2.0 s. No known failures; 368 unknown files, 0 running, 0 queued. Unverified as a clean-candidate gate because the report was present. |
| Independent real-adapter probes | Six bounded script jobs exited 0. They exercised mixed-side keys and reuse, verdicts, missing source, shared-path projects, dirty runner config, copied regular helpers and copied symlink helpers. An initial symlink fixture was refined to use a `.json` target; B3 uses the refined fixture. No local full suite ran. |
| Shipped Claude bundle, four deferred-option calls | Each exited 2, with one line naming row 023-11's unbuilt behavior: `--case dependency`, `--env X=1`, `--without x`, `--repeat 2`. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44208658048) | In progress at the last read. Lint and typecheck passed; version-sensitive checks and Node 22/26 test shards were still running. Full CI is pending, not a blocker from this review. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44208658360) | Completed successfully for this exact candidate. |

The focused wait used the session's absolute launcher, shown with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/proof.test.ts test/cli/proof-copy.test.ts \
  test/cli/proof-killed.test.ts test/cli/proof-args.test.ts \
  test/proof/sides.test.ts test/proof/verdict.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts \
  test/harness/shared/names-no-runner.test.ts
```

The affected-source wait named `src/cli/proof.ts`, `proof-side.ts`, `proof-args.ts`, `proof-report.ts`, `src/core/proof/sides.ts`, `verdict.ts`, `src/core/commit/at-keys-side.ts`, `at-keys-verify.ts`, `at-keys-walk.ts`, `src/cli/status-at-now.ts`, `status-at-run-select.ts` and `status-at.ts`.

Each independent probe used `timeout 600 pnpm exec tsx "$TMPDIR/probe.mts" <case>` through Squawk's job runner. Except for the first control, `NODE_ENV=test` was explicit. Every proof and gate call had a 600-second budget. Fixtures were real Git repositories under `$TMPDIR`, outside the reviewed checkout. The install linked this checkout's Vitest, as the candidate's integration fixtures do. Runs used the real adapter and the source CLI's real child entry. Each fixture asserted that only its main Git worktree remained, then removed its directory. All probe jobs ended; no probe process or fixture remained. The throwaway script was removed before committing.

## Blockers

### B1. Proven: a project's import error is presented as another project's assertion, producing `proven`

**Location:** `src/cli/proof-side.ts:191`–`:203`, called at `:138`.

**Contract:** D5.5 requires `red for another reason` for an import error. D5.6 requires exit 3 when any named file has that verdict. Project identity is part of `TestFileRef` and its key.

**Fixture:** Two Vitest projects list `test/a.test.ts`. Their names and `test.env.MODE` values are `assert` and `import`. Base exports `value = 1`; HEAD exports 2 and adds this test:

```ts
import { expect, it } from "vitest";
import { value } from "../src/a";
it("value", async () => {
  if (value === 1 && process.env.MODE === "import")
    await import("./absent-module");
  expect(value).toBe(2);
});
```

At the red side, project `assert` fails its assertion. Project `import` fails its dynamic import before the assertion. Both green projects pass.

**Observed:** The first call returns **0**, `runs: 4`, and **`proven` for both projects**. Both red failure records in the report say `AssertionError: expected 1 to be 2`. The second call, on the same commits and environment, returns **3**, `runs: 0`; `assert` stays proven, while `import` correctly reads `red for another reason`, with `Cannot find module '/test/absent-module' imported from test/a.test.ts`.

The store has the correct per-project results. `outcomesOf` reads each project's fail state, but `ranSide` discards its failure identity and takes the first failed gate run for the **path**. The first call therefore attaches another project's assertion evidence to the import failure. `endOfRecords` reads the correct evidence on reuse.

**One-worker fix:** Preserve the full project/file identity when obtaining a run's failure records. For stored runs, read the errors from that ref's exact-key records. For unstored runs, carry project identity through the outcome boundary or refuse a classification that cannot distinguish the projects. Do not infer assertion evidence from the first path match. Add this two-project fixture and require identical verdicts on first run and reuse, including coverage-off behavior.

### B2. Proven: a stored green pass under uncommitted runner config is certified as committed HEAD

**Location:** `src/cli/proof.ts:62`, `:85`, `:238`–`:242` and `:283`.

**Contract:** The wave brief requires proof sides to use committed HEAD. D5 defines green as the test and code at HEAD, under the same conditions as red. Vision principle 2 bars an old or different-state result from posing as current truth.

**Fixture:** Commit a Vitest config with `test.env.WANTED = "9"`. The test imports `value` from `src/a.ts` and asserts both `value === 2` and `process.env.WANTED === "2"`. Base exports 1; HEAD changes it to 2. Both commits retain the config's `"9"`. Then change only the working config to `WANTED = "2"`, without committing, and seed a real gate pass in that working tree.

**Observed:** `proof --case source` returns **0**, `proven`, `dirty: []`, `runs: 1`, green `pass` from the store. Its header and green side identify committed HEAD. Restore the committed config without changing either commit, then repeat: it returns **1**, `not green`; the green run fails `expected '9' to be '2'`.

`dirtyLoads` checks the test and its closure, but omits runner environment inputs such as `vitest.config.mjs`. The green lookup is valid for the working config's key. It is not evidence for committed HEAD. Red ran with the committed `"9"`, while the reported green pass used uncommitted `"2"`.

**One-worker fix:** Before using the current-side result as HEAD, establish agreement for every input represented by its key, including runner config, setup, policy, dependency and declared environment inputs. A conservative fallback to the existing HEAD checkout on such dirt is sufficient. Keep the dirty warning and label the committed side correctly. Add this config-only dirty fixture; require `not green`, with no reuse of the uncommitted pass.

### B3. Proven: copied symlink paths bypass the expected-tree check and store install replacements

**Location:** `src/core/commit/at-keys-side.ts:63`–`:64`, `:130`–`:134`; storage enabled at `src/cli/proof-side.ts:123`.

**Contract:** The brief says: “Store a side's result only when the whole-checkout check passes against the side's expected tree (the code version's tree with the copied paths at their test-version blobs).” This is the wave-7 storage bar applied to a mixed side.

**Fixture:** Base has `src/a.ts` exporting 1. HEAD exports 2 and adds the named test, `test/helpers/2.json` containing `2`, and a real tracked symlink `test/helpers/wanted.json -> 2.json`. The test imports `wanted.json` and asserts `value === wanted`. During red-checkout install, replace the copied `wanted.json` with a regular file containing JSON `3`. Leave the green checkout untouched.

**Observed:** First proof returns **0**, `proven`, with red `fail`, `from: "run"`, **`stored: true`**, `notStored: null`, and `expected 1 to be 3`. Green passes. A second call with the same install returns **0**, `runs: 0`, and reuses that red failure from the store, still with `expected 1 to be 3`.

The side's test version holds a symlink to JSON 2, not a regular JSON 3 file. `testSource` writes the link blob as plain text and deliberately omits mode `120000` from `expected`. `sideKeys` then places that copied path in `skip`. Thus neither its type nor its data is checked; the install can replace it while `changed` remains null and storage stays enabled. This proves forbidden storage and attribution of the replacement. It does not claim that the honest side's content key was poisoned; keying sees the replacement bytes.

**Control:** The same install rewrite on a new regular helper `test/helpers/wanted.ts` is detected. Red still contributes its assertion to the verdict, but reports `stored: false` and `install changed the checkout: test/helpers/wanted.ts`. It runs again on the next call. A later honest install runs the proper expected-2 side and stores it. Preserve this behavior.

**One-worker fix:** Remove the unchecked copied-symlink exception. Preserve a committed link's kind and target when preparing the side, then compare it with its test-version entry using the whole-checkout verifier. If that representation cannot be supported, refuse storage explicitly. A copied path must never be silently excluded from the side's expected tree. Add the rewritten-symlink fixture and check both storage flags and later reuse.

## Should-fix and nits

No additional findings. Pending CI and unknown affected checks are verification limits, not blockers. This review makes no full-suite claim.

## What fits

- The ordinary mixed side has its own key. A real base pass at `844be492025e0f52dc958604acce8614d2bad4563b42e553ae3bb9c50a92b812` was not reused for the new test over old source, whose key was `2b29cd36067a5d89790b6c9413488cb458576b56cf19146f211bc28557e1c22d`. That side ran its assertion failure. The next proof read both sides from the store with `runs: 0` and retained the assertion text.
- An old-code pass reads `not red`, exits 1 and leaves green unread. A new source import absent at base reads `not comparable`, names the missing source and base commit, exits 3 and runs nothing.
- All four deferred options are refused by the shipped bundle with exit 2 and the required row 023-11 explanation.
- The candidate's real-adapter tests for source and test-only fixes, helper copying, loaded-source dirt, changed-checkout reporting and killed-run cleanup have current passing Squeal results. The killed-run test checks both the runner and its test-spawned process, then sweeps the checkout.
- The regular copied-file expected-tree guard works, including a path added only on the test side. Version and bundle checks pass without build drift.

## Inputs for the repair and next wave

Repair B1–B3 before conditions and repeat. Keep a side as `(tests, code)`, keyed by the real gate keyer after preparation in its own checkout. Keep full `TestFileRef` identity through stored and run failure evidence. A current-side key may represent green only after its inputs are proven to match committed HEAD. Every copied committed path must participate in the expected-tree check with its kind, mode and blob; a mismatch may run and contribute its outcome, but stores nothing and says why.

Keep the single remaining deadline across keying, install and run; use the existing `runInChild` ownership and cleanup; close adapters before removal. Preserve exact-key store-first reuse and the refusal for missing source imports. Row 023-11 still needs forced runs and no storage under conditions, plus repeat; those deliberate deferrals are not failures of this row. Use focused real-adapter regressions and the affected checks for repair review. Do not run a local full suite. Full CI at the exact release commit remains a separate release requirement.
