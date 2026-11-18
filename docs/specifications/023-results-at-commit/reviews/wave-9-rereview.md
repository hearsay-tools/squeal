# Wave 9 re-review: private HOME and safe hiding

PASS 6254ae87fb38acbccd910721d4bff1076093ab16

All three blockers from `wave-9.md` are closed. Zero blocking findings remain. One new, nonblocking note concerns the time spent preparing a large kept HOME folder. No product code was edited.

Scope: candidate `cand/0.1.562`, repairs `d220b5d2b`, `d81a2c6b3` and `aae873fc8`, their changed callers, tests and bundles. This is a bounded re-review of B1 through B3 and the new `--home-keep` boundary. D5.3 now follows the human's 2026-11-18 decision, **"B: empty + --home-keep"**: an empty private HOME, explicit byte copies, links refused, hidden paths omitted. The settled wave 9 store, repeat and project-evidence rules were not re-prosecuted.

## Verification

The code checks and independent probes below ran at the exact candidate on a clean product tree, before adding this report. The prepared installation was retained. No setup install or local full suite was run.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach 6254ae87fb38acbccd910721d4bff1076093ab16`; `git rev-parse HEAD`; `git status --short` | Exact requested candidate; clean. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3721 files in 1899ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `timeout 600 pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed; no bundle drift. |
| `timeout 600 pnpm run check:version origin/main HEAD` | Exit 0: `0.1.561 -> 0.1.562, ok`; adapter `1.0.3 -> 1.0.3, ok`. |
| Focused Squeal wait | Exit 0 at revision 4, `6254ae87 + 0`: all seven named test files current, no known failures, after 19.0 s. Whole worktree still had 116 of 1978 files not current. |
| Repeated focused wait, adding key-format and version-sensitive tests | Exit 0 at revision 4: all nine named test files current, no known failures, after 2.1 s. Whole worktree still had 25 of 1978 files not current (19 queued, six unknown). |
| Affected-source Squeal wait | Exit 3 after 61.1 s at revision 4: 309 selected files, 291 current passes, 18 queued. No known failures. Whole worktree had 25 files not current, including six unknown. Incomplete evidence, not a full pass. |
| `timeout 600 pnpm run check:private`, after the findings-only commit | Exit 0; committed-HEAD scan passed, including this report. Warning: `SQUEAL_PRIVATE_DENYLIST` is empty, so the denylist rule is skipped. |
| Final `squeal status --wait 60000`, on the report-only descendant | Both reads exited 0 but returned on timeout: 60.6 s at revision 6, then 60.7 s at revision 7. No known failures; 24 of 1978 files not current (18 queued, six unknown), with 17 affected files pending. Supplemental evidence on docs descendants, not an exact-candidate gate. |
| Independent probes | Nine completed jobs exited 0. Real Git repositories and Vitest runs, plus direct checks of the removal backstop. Details below. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44299153586) | At the last read, Node 24 lint/typecheck/version-sensitive/build job passed. The six Node 22/26 test shards remained in progress. Full-suite result unverified. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44299153730) | Completed successfully at this exact candidate. |

The focused wait used the session launcher, shown with `~`:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/cli/proof-review9.test.ts test/proof/own-home.test.ts \
  test/commit/at-keys-hidden.test.ts test/cli/proof-args.test.ts \
  test/cli/proof-conditions.test.ts test/cli/proof-repeat.test.ts \
  test/cli/proof-killed.test.ts
```

The source wait named `src/core/proof/own-home.ts`, `src/cli/proof-locate.ts`, `src/cli/proof-side.ts` and `src/core/commit/at-keys-side.ts`.

Each probe job used Squawk's job runner with `env HOME="$TMPDIR/w9r-bootstrap-home" NODE_ENV=test timeout 600 pnpm exec tsx "$TMPDIR/w9r-probe.mts" <case>`. Cases: `b1`, `b2`, `b3`, `refusals`, `copies`, `large`, `regression`, `killed`, `killed-copy`. Each fixture, original HOME, private HOME, cache, counter and observation file was under `$TMPDIR`. No probe used the actual account HOME. The test installer linked the candidate's Vitest, as the repository's integration fixtures do; these probes do not independently validate a frozen package-manager installation. They exercised the real parser, proof command, checkout machinery, child CLI and runner adapter.

An initial B2 probe expected `proven` for its recursive-removal control, although that fixture's committed red test already passed. The actual `not red` was correct. The corrected job passed, including the external-target and direct backstop assertions. This was a harness error, not a candidate finding.

## B1: closed, private HOME contains independent copies

**Proven by real-adapter fixtures and source inspection** of `src/core/proof/own-home.ts` and `src/cli/proof-run.ts`.

The original escape fixture now returns `proven` because the old test cannot read `.proofrc`. With no keeps, its private HOME contains none of the original entries. With `--home-keep` for `kept` and `cfg`, plus an overlapping keep for `cfg/other`, its observations are:

```text
direct .proofrc: absent
raw kept/../.proofrc: absent
.alias: absent
kept/untouched: keep
cfg/secret (also hidden): absent
cfg/other: other
unkept: absent
```

The test writes and deletes through the raw `kept/../.proofrc` path, overwrites a kept file and removes the private kept folder. The original hidden file, original kept file and original `.alias -> .proofrc` remain unchanged. Result rows stay empty. Both sides run and report their conditions, including every `conditions.homeKeep` entry.

Additional boundary probes pass:

- A selected link, a path beneath a directory link, a dangling link and a link deep in a kept folder each exit 2 before any checkout. The error names the link. A missing keep, an outside-HOME keep, a keep inside the hidden path, and a keep with no HOME path hidden also exit 2.
- Keeping the entire throwaway HOME refuses unrelated links. After removing those links, it succeeds and omits the complete hidden subtree, including an unreachable link inside that subtree. No hidden target is visited.
- Two original files sharing an inode become separate regular copies. Their private inodes differ. Writing one copy and deleting the other leaves both original names and their shared original inode unchanged.
- A FIFO and a live Unix socket inside a kept folder are omitted. The copy does not block on either. The hidden ordinary file is also absent. This matches the worker's stated special-file behavior; no device node was created or tested.
- An install that replaces a validated kept regular file with a link is caught when the private HOME is built. The result is `not comparable (own HOME: ~/kept is a link; a kept path must hold none)`, zero runs. The original hidden target survives.
- A kept tree containing 12,000 files copies successfully on both sides. Each side asserts the complete regular-file count and final file's bytes, then overwrites that private file. The original sample remains unchanged. Total command time was 9.25 s. The small-budget variant is described in N1.

This closes the earlier link-based escape. It does not claim to sandbox arbitrary absolute paths a test chooses, or prove the absence of every concurrent filesystem race.

## B2: closed, repository removal does not follow parent links

**Proven by real Git fixtures and the direct backstop.** Locations: `src/cli/proof-locate.ts` (`linkedWithout`), `src/core/proof/conditions.ts` (`linkOnPath`) and `src/core/commit/at-keys-side.ts` (`removeHidden`).

The original `--without linked/victim` fixture now exits 2 with one line naming `linked`, before a checkout or test run. The victim folder and its nested file survive. Hiding the link itself also exits 2, as the repaired contract specifies. Both refusals hold when the link exists at base only, at HEAD only, or at both commits.

Hiding an ordinary repository folder that contains a link removes that folder only in the temporary checkout. Its external target survives. This control correctly reads `not red`: its old test already passes. Direct calls to the actual `removeHidden` backstop refuse a symlink parent and safely remove a terminal link without touching its target. The normal proof tree and every external fixture file stay unchanged.

## B3: closed, changed conditioned checkout yields no proof

**Proven by the original false-proof/control pair and variants.** Location: `src/cli/proof-side.ts`, the `broken` branch before a file enters the pending run map. The run's not-stored reason in `src/cli/proof-run.ts` also preserves an install change.

Both commits hold `value = 2` and tracked `config/local`. Base test requires that file to be absent; HEAD test requires `value === 2`.

| Install behavior with `--case dependency --without config` | Actual result |
| --- | --- |
| Honest link install | Exit 1, `not red`, one red pass. |
| Restores `config/local` | Exit 3, `not comparable`, zero runs. |
| Restores `config` as a regular file | Exit 3, `not comparable`, zero runs. |
| Leaves a dangling link at `config` | Exit 3, `not comparable`, zero runs. |
| Changes another tracked file | Exit 3, `not comparable`, zero runs; names that file. |
| Restores `config` on red only | Exit 3, `not comparable`, zero runs. |

Each refusal names the changed path and says `the condition is not known to hold`. No result rows are written. The former false `proven` verdict is gone; the whole-checkout comparison still detects unrelated tracked changes.

## Preserved behavior and cleanup

**Proven by independent controls.** A plain source proof first stores red and green failures. Two `--env GREEN=ok` calls ignore both stored outcomes, run both sides, return `proven` and leave all result rows unchanged. A later plain call reads the original failures with zero runs. The repeat control fails red on run 2, uses that run's `expected -1 to be 2` assertion, stops red there and passes green three times: five total runs, `proven`, nothing stored.

SIGKILL probes cover three phases:

- During red: two abandoned checkouts; the recorded worker and its spawned descendant stop.
- During green: one abandoned checkout; both recorded processes stop.
- During private HOME copying: the first kept file exists, the final one does not yet exist, and the run group has not started. The command is killed with two checkouts open.

In all three cases, the next `status --at` that creates a checkout sweeps the abandoned checkouts. It exits 3 because results are unknown; cleanup succeeds. Original hidden and kept files survive. During red and green, the test also adds a private HOME link to a separate throwaway target; sweeping removes the link and preserves its target. Every completed fixture asserts no remaining checkout and exactly one Git worktree.

## N1: nonblocking note, HOME preparation has no deadline check

**Proven observation; new-delta note in this bounded re-review.** Locations: `src/core/proof/own-home.ts:47`, `:110` and `:121`; `src/cli/proof-run.ts` builds the private HOME before checking the remaining seconds.

The 12,000-file fixture with `--timeout 1 --repeat 3` returned after 2.15 s. It started zero tests, reported `not comparable (budget)` and retained `--home-keep`, both conditions and repeat in its `--timeout 60` rerun line. The verdict is honest. However, validation and copying walk the complete selected tree synchronously, without a deadline argument. Larger keeps can add preparation time before the run-budget check. No overrun at the ordinary 600-second budget was measured.

A small follow-up can pass the existing proof deadline through the HOME validator and copier, stop at directory/file boundaries, and map exhaustion to the existing budget result. A byte read already in progress needs its own stated limit if a strict wall-clock cap is required. This note does not reopen the three resolved blockers.

## Next inputs and limits

No remaining blockers or nits in this bounded re-review. Preserve the empty-HOME contract, copies that leave hidden subtrees out, both commit-tree link checks and the actual-parent removal backstop. Keep the conditioned-side refusal before running when the expected-tree check changes. Keep forced runs unstored and preserve the first failing round's complete evidence. N1 is follow-up input; broader affected coverage and full-suite CI remain incomplete verification, not findings against the repaired wave. This review does not supply release approval or a full-suite pass.
