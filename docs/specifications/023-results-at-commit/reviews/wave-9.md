# Wave 9 review: conditions, repeat and dependency proofs

FAIL 85fd5eb917f10cf1215d6e0ebd7f287d52730d37

Three proven blockers: B1, the private HOME links expose and permit deletion of the hidden original file; B2, repository hiding follows a symlink ancestor and deletes outside the checkout; B3, an install can undo `--without` and produce a false `proven` verdict. No product code was edited.

Candidate: `cand/0.1.562`. Range: `eebd7cae5a3495333d82902457c2972f91848d58..85fd5eb917f10cf1215d6e0ebd7f287d52730d37`. Scope: row 023-11, D5.1 as amended 2026-11-18, D5.3 through D5.6, the changed status reader and checkout seams. The wave 8 findings supply the evidence and storage bar; their settled mechanisms were checked only where this delta uses them.

## Verification

All code checks and independent probes ran at the exact candidate on a clean product tree, before this report was added. The prepared frozen installation was retained, as requested. No setup install was repeated. No local full suite ran.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD`; `git status --short` | Exact requested SHA; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3718 files in 1102ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no bundle drift. |
| `timeout 600 pnpm run check:version origin/main HEAD` | Exit 0: `version bump: 0.1.561 -> 0.1.562, ok`; `adapter version: 1.0.3 -> 1.0.3, ok`. |
| Focused Squeal wait below | First read: eight current passes, one unknown, exit 3. Second read: all 11 named files current at revision 0, no known failures, exit 0 after 10.6 s. Whole-worktree coverage remained incomplete: 434 of 1976 files not current. |
| Affected-source Squeal wait | Exit 3 after 60.9 s at revision 0: 313 selected files, 185 current passes, two queued and 126 unknown. No known failures. This is incomplete evidence, not a full pass. |
| Final `squeal status --wait 60000`, with this report present | Exit 0, `Returned on quiet`, after 5.0 s at revision 1: the documentation edit affects no test. No known failures; 224 of 1976 files not current (two running, 222 unknown). Supplemental evidence on a docs-dirty tree. |
| `timeout 600 pnpm run check:private`, after the findings-only commit | Exit 0; committed-HEAD scan passed, including this report. Warning: `SQUEAL_PRIVATE_DENYLIST` is empty, so the denylist rule is skipped. |
| Independent real-adapter probes | Nine completed probe jobs exited 0, including assertions that distinguish expected behavior from the three reproduced defects. Real Git repositories and Vitest runs; details below. |
| Shipped Claude Code bundle usage probes | Exit 2 for `--case dependency` without a condition and for `--repeat 101`. The first error names the missing condition; the second names the 1 to 100 bound. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44286663049) | At the last read, Node 24 lint/typecheck/version-sensitive/build job passed. All six Node 22/26 test shards remained in progress. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44286663065) | Completed successfully for this exact candidate. |

The focused command used the session launcher, shown with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/proof-args.test.ts test/cli/proof-conditions.test.ts \
  test/cli/proof-repeat.test.ts test/cli/proof-killed.test.ts \
  test/cli/proof-review.test.ts test/cli/proof-rereview.test.ts \
  test/commit/at-keys-hidden.test.ts test/proof/conditions.test.ts \
  test/proof/verdict.test.ts test/keys/key-format.test.ts test/version-sensitive.test.ts
```

The source wait named `src/cli/proof.ts`, `src/cli/proof-run.ts`, `src/core/proof/conditions.ts`, `src/core/commit/at-keys-side.ts`, `src/core/commit/at-keys-verify.ts` and `src/cli/status-at-run-outcome.ts`.

Probe jobs used Squawk's job runner with `env HOME="$TMPDIR/probe-bootstrap-home" NODE_ENV=test timeout 600 pnpm exec tsx <probe.mts> <case>`. Cases: `home`, `repo`, `store`, `repeat`, `projects`, `budget`, `killed`, `restore`, `stale-green`. Every fixture, cache, observation, counter and command HOME was under `$TMPDIR`. Each command got its fixture's throwaway HOME. No probe used the actual account HOME. The install linked the candidate's Vitest, as the repository's integration fixtures do; these probes do not independently validate a frozen package-manager install. They use the actual proof command, parser, checkout code, child CLI and runner adapter. Each completed fixture asserted that no checkout remained and only its main Git worktree remained.

Two initial probe jobs had harness errors: budget supplied `--timeout` twice; the killed-run sweep queried a fixture whose main tree lacked the Vitest link, so it made no checkout. Corrected jobs passed. The killed worker and its descendant were already stopped in the initial probe; its dead throwaway fixture was removed. Neither harness error is a candidate finding.

## B1. Proven blocker: the private HOME links reach the hidden original file

Location: `src/core/proof/conditions.ts:121` through line 125; called by `src/cli/proof-run.ts:83`.

D5.3: **"`--without <path>` hides a file or folder (a path under `HOME` is hidden by giving the run its own `HOME` holding everything else the test reads there)."** The supplied HOME view must not expose the hidden original through the links Squeal creates.

Reproduction on a real `dependency` proof:

1. Command HOME contains `.proofrc` with `ada`, and the ordinary directory `kept` containing `untouched`.
2. Request `--without "$FIXTURE_HOME/.proofrc"`.
3. The red test uses these literal paths. Do not normalize the second one before the OS resolves it:

```ts
const direct = process.env.HOME + '/.proofrc';
const via = process.env.HOME + '/kept/../.proofrc';
// existsSync(direct) === false
// existsSync(via) === true; readFileSync(via, 'utf8') === 'ada'
writeFileSync(via, 'changed');
unlinkSync(via);
```

Actual observation: `{"direct":false,"via":true,"text":"ada"}`. The write succeeded, and the original hidden `.proofrc` was deleted. The proof still exited 0, `proven`, with two runs and the HOME condition in its report. The sibling `kept/untouched` survived cleanup. A separate fixture with an original `.alias -> .proofrc` also exposed the hidden file through the run's `.alias`.

Cause: `mirror` makes `ownHOME/kept` a link to the original directory. Filesystem resolution of `kept/..` enters the original HOME. It also links to an original symlink instead of recreating that link within the private view. A run can thus change the original files and alter what the next side sees. This is a defect in the supplied HOME view, not a demand to sandbox arbitrary absolute filesystem access.

Worker-sized fix: create a private HOME view without directory or file links back into the command HOME. Copy the supported entries and preserve or translate safe internal links within that view; refuse an entry whose target cannot preserve the hidden-path condition. Do not dereference a link into a hidden subtree. Add real-adapter fixtures for direct absence, an ordinary sibling directory plus `..`, a relative alias, writes/deletes, and surviving original files after normal and killed cleanup.

## B2. Proven blocker: repository hiding deletes through a symlink ancestor

Location: `src/core/commit/at-keys-side.ts:91` through line 92. Placement at `src/core/proof/conditions.ts:52` checks lexical containment only.

D5.3 and the wave brief put repository hiding **in the checkout** and reject paths outside the repository and HOME. The existing copy boundary also refuses symlink parents. The new removal boundary must preserve that containment.

Reproduction:

- A fixture commits `linked`, a directory symlink to its separate throwaway HOME.
- That HOME contains `victim` with `must survive`.
- Invoke `proof test/a.test.ts --base <base> --case dependency --without linked/victim`.
- The installer only links Vitest. No test deletes or opens `victim`.

Actual: the command deletes the external `victim`, reports the path as hidden in the repository and exits 0, `proven`. The original checkout's `linked` entry is unchanged. The deletion happens in the green checkout's `prepare`, before the install or either test. `rmSync` does not follow a terminal link, but the OS follows `linked` while resolving its parent path.

Worker-sized fix: inspect every parent component in the actual checkout before removal and refuse a symlink ancestor, as `copyIntoCheckout` already does for writes. Apply the check on each side; do not rely only on the working tree's paths. Keep safe terminal-link removal. Add a real fixture with a tracked ancestor link to an external directory, a victim folder with children, and a terminal-link control. No external target may change on refusal.

## B3. Proven blocker: an install can undo `--without` and create a false proof

Location: removal before installation at `src/core/commit/at-keys-side.ts:91`; continued run at `src/cli/proof-run.ts:108`; the reported reason at `src/cli/proof-run.ts:130` masks the detected checkout change.

D5.3 says both sides run under the named condition. The brief also requires a repository path to be counted in the expected tree. Detecting a restored hidden path only for storage does not establish that the condition held during the run.

Discriminating real-adapter fixture:

- Both commits have source `value = 2` and tracked `config/local`.
- Base test asserts that `config/local` is absent. HEAD test asserts `value === 2`.
- With an honest link install, `--case dependency --without config` returns **1, `not red`**, one red pass. That is the expected control.
- Change only the install hook to recreate `config/local` after the candidate removes `config`.

Actual with that install: **0, `proven`**, red fails `expected true to be false`, green passes, two runs. Both sides say `not stored (a side under a condition is never stored)`. The report claims `--without config`; it never names the install's restored path. Result rows remain empty, so storage isolation works, but the claimed proof does not.

The whole-checkout comparison detects that `config` is present. `withSide` still runs it; `ranSide` accepts its observed outcome, while `forcedReason` replaces the checkout-change reason. That behavior is allowed for an unrelated install change in an ordinary unstored proof. It cannot establish a condition that the install undid.

Worker-sized fix: enforce the hidden-path condition after the install and before running, or refuse the side with the restored hidden path named. Keep the whole-checkout check for all other tracked paths and preserve wave 8's unstored handling for unrelated install changes. Add the control/false-proof pair above, including a restored folder and a dangling terminal link. A recreated hidden path must never yield a proof claiming it was absent.

## What fits

The following are proven by independent fixtures, in addition to the focused current tests:

- **Conditioned store isolation.** A plain call seeds a stored red pass. Two `--env PROOF_NAME=` dependency calls each run both sides, return `proven` and leave the complete result rows unchanged. A later plain call reuses the original pass with zero runs. A second fixture seeds stored red and green failures; `--env PROOF_GREEN=ok` ignores both stored results on two calls and proves the fix. A later plain call still reads the original green failure with zero runs. Both unsetting and setting work.
- **Repeat.** A stored red pass does not replace repeat evidence. Red fails on run 2 of 3 and stops there; green passes all 3; total 5, with run 2's `expected -1 to be 2` evidence. Results remain unchanged. A green failure on its second run of 4 returns `not green`, exit 1; no later green run starts. Red passing all 3 returns `not red`, exit 1, without running green.
- **Per-project evidence per round.** Two projects pass round 1 and fail round 2 with different assertion messages. With conditions and repeat, each reports `not comparable`, two red runs, no attributed failure text and exit 3. Repeating the call with fresh counters gives the same answer, four file runs, no stored results. It does not borrow another project's message or a prior round's pass.
- **Budget.** A one-second call starts no test and reports `not comparable (budget)`, zero runs and a rerun retaining case and repeat with `--timeout 60`. A 15-second, 100-repeat call makes one red run and seven green passes, then reports green `not run (budget)`, seven green runs, total eight, exit 3, with the rerun line. It takes 14.27 s and never labels the incomplete green side a pass.
- **Ordinary hiding.** Direct HOME-file hiding proves the dependency fix, leaves the hidden original and a kept sibling unchanged, and stores neither side. Hiding an ordinary repository folder proves the dependency fix and leaves the working-tree file unchanged. The focused expected-tree tests pass.
- **Usage.** The parser and shipped bundle refuse dependency without conditions, exit 2. A path outside the repository and throwaway HOME returns one explanatory error line with no run. The bundle refuses repeat 101.
- **Killed runs and link cleanup.** SIGKILL while red holds leaves two abandoned checkouts; while green holds, one. In both cases the recorded Vitest worker and its spawned descendant stop. A subsequent `status --at` that makes a checkout sweeps all abandoned checkouts. It exits 3 because results are unknown; the sweep succeeds. The hidden original HOME file, its kept sibling, and the target of a new link the test placed in its private HOME all survive. Cleanup itself did not follow a link. No probe process or checkout remains.

## Should-fix, nits and next-wave inputs

No separate should-fix items or nits. The broader affected checks and full-suite CI remain incomplete verification, not findings against this wave.

Dispatch B1 to the HOME-view owner, B2 to repository removal and B3 to post-install condition enforcement. B2 must check the destination side's actual parents before any deletion. B3 must establish absence after installation before accepting a run as conditioned. Keep `store: false` and `outcomesOf({ stored: false })` for conditioned/repeated runs; keep the complete failure-evidence comparison across projects and the first failing round's evidence. Preserve the one deadline across both sides and all repeats, with explicit budget gaps. Retest cleanup after changing the HOME representation. Do not widen these repairs into the settled green-checkout or ordinary unstored-proof mechanisms.
