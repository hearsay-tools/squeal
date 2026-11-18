# Wave 8 third review: committed green checkout and failure evidence

PASS 672ca7f259fe5b65f4f71e5dfab1c214ed719edf

Zero blocking findings remain. B1 and B2 from `wave-8-rereview.md` are closed. B3 from `wave-8.md` stays closed. The amended D5.1 rule holds in the independent fixtures: green is keyed in a checkout at committed HEAD after its install, then read at that key or run there. A passing working-tree result cannot stand for a different committed installation.

Scope: candidate `cand/0.1.561`, repairs `0d8b23c61`, `858874bc4` and `cf6dbc516`, their changed callers, bundles and worker notes. This is a bounded re-review of the earlier findings and the new green-checkout path. Main 0.1.560's unrelated changes are outside it. No product code was edited.

## Verification

All candidate checks and fixture probes below ran at the exact requested commit on a clean product tree, before this report was added. The prepared dependencies were retained; no setup install was repeated. The lint invocation itself reported its lockfile policy check and `Already up to date` in 80 ms.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch && git checkout --detach 672ca7f259fe5b65f4f71e5dfab1c214ed719edf`; `git rev-parse HEAD`; `git status --short` | Exact candidate; clean tree. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3711 files in 1503ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no bundle drift. |
| `timeout 600 pnpm run check:version origin/main HEAD` | Exit 0: `0.1.560 -> 0.1.561, ok`; adapter `1.0.3 -> 1.0.3, ok`. |
| Focused Squeal wait below | Exit 0 at revision 9, `672ca7f2 + 0`: all 14 named files current, no known failures, after 2.4 s. Whole worktree still had 599 files not current. |
| Affected-source Squeal wait | Exit 3 after 60.7 s: 306 selected files, 148 current passes, 158 pending; no known failures. Broader coverage remains incomplete. |
| Repeated affected-source wait | Exit 3 after 60.7 s at revision 9: 193 current passes, 113 pending; whole worktree had 259 files not current, no known failures. |
| Final `squeal status --wait 60000`, with this report present | Exit 0 but returned on timeout after 60.5 s at revision 11: 188 affected files pending, no known failures. This is incomplete supplemental evidence, not a clean-candidate gate. |
| `timeout 600 pnpm run check:private`, after the findings-only commit | Exit 0; committed-HEAD scan passed, including this report. Warning: the private denylist is empty, so that rule is skipped. |
| Independent real-adapter probes | Seven completed probe jobs exited 0: 40 proof calls, eight `status --at` calls, real Git repositories and Vitest runs, including real offline pnpm installs. Details below. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44278058043) | In progress at the last read. No full-suite conclusion is claimed. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44278058210) | Completed successfully for this exact candidate. |

The focused wait used the session's absolute launcher, shown with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/proof-review.test.ts test/cli/proof-rereview.test.ts \
  test/cli/proof-killed.test.ts test/cli/proof.test.ts test/cli/proof-copy.test.ts \
  test/cli/status-at.test.ts test/cli/status-at-run.test.ts \
  test/cli/status-at-run-review.test.ts test/cli/status-at-run-env.test.ts \
  test/cli/status-at-run-inputs.test.ts test/commit/at-keys.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts \
  test/harness/shared/names-no-runner.test.ts
```

The probe command was `NODE_ENV=test timeout 600 pnpm exec tsx /tmp/wave8-third-probe.mts <case>`, launched through Squawk's job runner. Cases were `projects`, `drift`, `links`, `green`, `controls`, `killed` and `mixed`. Fixtures lived in `$TMPDIR`, outside the product worktree. The ordinary install linked this checkout's Vitest, as the integration fixtures do. The dependency fixture used real pnpm, committed local packages, isolated package storage and frozen offline installs with scripts disabled. Every proof had a 600-second budget. Every completed fixture verified that only its main Git worktree remained, then removed its directory. The probe script was removed before committing. No probe process or fixture remains. No local full suite ran.

Three initial probe launches stopped on incorrect harness assumptions: the parser returns an error object; an absent named file retains its absence reason; a lookup of an absent file makes no checkout and therefore performs no checkout sweep. The corrected probes passed. These were harness errors, not candidate findings.

## B1: closed — each project's evidence is its own, or refused

**Proven by independent fixtures and source inspection** (`src/cli/proof-side.ts`, `resultsAt`).

| Fixture: two projects list one path | First call and reuse |
| --- | --- |
| Coverage on; one red assertion and one red dynamic-import error | Exit 3; `assert` is `proven`, `import` is `red for another reason`, with its missing-module error. First call runs three sides; second runs zero. |
| Coverage off; assertion versus import error | Exit 3; both `not comparable`, no attributed failure text, two red runs on each call. |
| Coverage off; both assertions, different messages (`MODE=assert` and `MODE=import`) | Exit 3; both `not comparable`, `from: run`, no failure text, `runs: 2` on both calls. |
| Same differing messages, coverage on but install rewrites tracked config | Same refusal on both calls; nothing stored, reason names the changed config, `runs: 2`. |
| Coverage off; identical assertion evidence in both projects | Exit 0; both `proven`, unstored, four runs on each call. |

The comparison now checks the complete error evidence instead of error kinds alone. It refuses the earlier false-message case. Stored evidence still comes from the file's own project, path and key. The earlier nonblocking run-count error is also closed: ambiguity preserves `from: run` and counts execution.

## B2: closed — green belongs to committed HEAD

**Proven by the same real-pnpm drift fixture as the second review.** The committed manifest and lockfile select `proof-dep` 1.0.0 from `vendor/one`, exporting 9. The ignored installed state selects version 2.0.0 from `vendor/two`, exporting 2. Git status is empty. The committed test requires source value 2 and dependency value 2. Base source is 1; HEAD source is 2. A real passing gate result is first seeded in the differing working-tree installation.

The first proof now returns **1, `not green`**, `dirty: []`, two runs. Red fails the source assertion; green runs after a real frozen install at HEAD and fails `expected 9 to be 2`. A second call returns the same verdict with **zero runs**, reading the committed sides' results. A frozen reinstall in the working tree changes neither the proof verdict nor its zero-run reuse. The stored working-tree pass never reaches green.

The earlier dirty-config fixture also stays closed. A local config sets `WANTED=2`, while HEAD commits `WANTED=9`. After seeding the local pass, proof returns `not green` from a green failure at HEAD. Staging that config still returns `not green`, now from the store. Replacing the working-tree test with a passing version and seeding its pass also leaves the committed verdict unchanged; the dirty report names the test. Changing the local runner config to list two projects does not change HEAD's single-project proof listing.

The repair removes the working-tree green path and its special dirty-tree branch. `withSide` keys green through `sideKeys(... listed: true)` in its checkout; the case uses that checkout's closure and projects. Stored reuse still avoids test runs. The extra checkout cost is the human-approved tradeoff in amended D5.1, not an unresolved installed-dependency exception.

## B3 and mixed-side storage: remain closed

**Proven by independent fixtures.** An install that replaces a copied link with a regular file, retargets it internally, retargets it to an external absolute file, or deletes it stores no red result. The first three can report the observed assertion proof, explicitly unstored; deletion reads `red for another reason`. A repeated call runs red again. Each storage refusal names `test/helpers/wanted.json`. An honest link preserves its committed kind and target, stores the result, and reuses it with zero runs.

A separate fixture changes both source and test helper. Base source/helper are 1/1; HEAD is 2/2. A seeded HEAD pass does not substitute for the mixed red side (base source 1, HEAD helper 2). Proof runs red and reports `expected 1 to be 2`; the second call reuses that failure. A plain `status --at <base>` still has **no result** for its distinct 1/1 key. Running the plain base stores a pass there; repeating proof keeps its mixed failure and zero-run reuse. No wrong-key result escaped between these trees.

In another fixture, the red install changes the copied helper to 3. Both calls show `expected 1 to be 3`, explicitly unstored. An honest install then runs red, reports `expected 1 to be 2`, stores it, and permits zero-run reuse. The modified copied file did not seed the honest mixed-side key. The whole-checkout comparison against the side's expected tree remains the single storage check.

## New green-checkout failures and cleanup: pass

**Proven by independent fixtures.**

- A controlled failed frozen install gives both committed named files `not comparable` with the install's reason. Case and red side are undecided, `runs: 0`, and only the green install is attempted. No checkout remains.
- A Git executable wrapper refuses the actual `git worktree add` with exit 71. Proof gives `not comparable`, includes the checkout failure, runs no file and leaves no checkout or extra worktree.
- SIGKILL during a holding red test finds **two** open checkouts. The test worker and a process it spawned both stop. A subsequent `status --at HEAD` makes a checkout and sweeps both abandoned checkouts. Only the main worktree remains.
- SIGKILL during the green run finds **one** remaining checkout, because red has closed. Its worker and spawned process also stop; the next checkout command sweeps the abandoned green checkout.

The kill probes checked the recorded worker and descendant PIDs, treating zombies as stopped. No recorded probe PID remains. A query for a file absent at the requested commit does not create a checkout and is not the sweep trigger; the passing cleanup probes use a command that makes one, as the existing cleanup contract requires.

## Shared status reader and controls: pass

A two-project fixture has opposite results at base and HEAD. `status --at <base> --run --all-missing` selects, runs and stores two files: `assert` passes, `import` fails. Plain lookup preserves that pair. After a real gate run at HEAD, status reports `assert` as `pass -> fail` and `import` as `fail -> pass`, exit 0, with separate project keys. No regression was found in the changed listing helper or current-side reader.

A test-only helper fix returns `proven` and then reuses both sides. A test that passes on old code returns `not red`, exit 1. An import of source absent at base returns `not comparable` without a run. The actual source CLI rejects `--case dependency`, `--env`, `--without` and `--repeat` with exit 2 and the row 023-11 explanation.

## Blockers, should-fix and next inputs

No blockers, should-fix items or nits were found in this bounded review. Preserve the complete-evidence comparison, project-aware result reader, committed green checkout, expected-tree storage check and two-checkout cleanup. Conditions and repeat remain row 023-11's work. Broader affected checks and exact-candidate CI remain verification limits; this PASS does not claim a full-suite result or authorize release.
