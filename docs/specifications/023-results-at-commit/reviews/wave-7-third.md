# Wave 7 third review: commit input byte check

FAIL bf901fc487bef0191aa8226404102ce689f8587a

One proven blocker remains: B5, with two reproduced link cases. The original hidden source rewrite, executable-mode change and internal link retarget are refused. Both gaps named in `tasks/023-07-notes.md` still run and store a pass from changed commit files.

This review is bounded by `wave-7-rereview.md`, the byte-check repair `bf3e7d42b` and its bundles. The candidate is `cand/0.1.552`, rebuilt on main 0.1.550. Findings B1–B4, B6 and B7 stay closed for the scenarios settled by the preceding review; this review does not repeat them.

## Remaining blocker

### B5 — proven: changed links with no current in-tree target escape the byte check

**Locations:** `src/core/commit/at-keys-verify.ts:102` and `src/core/commit/at-keys-checkout.ts:200`.

**Contract:** Goal 3 and D4.7, plus the review brief: a stored result must come from exactly the named commit's files; nothing else may be stored. Both named gaps break that rule. They are blocking cases of the existing B5 mechanism, not speculative hardening.

`inputCheck` detects the changed tracked link, but `resolvedIn` returns `null` both for a target outside the checkout and for a deleted link. `throughLink` then refuses only if the post-install closure lists the link's own path. In these cases it does not. The post-install resolution has already replaced or removed that path, so the check treats the changed resolution as proof that the changed link is irrelevant.

**Shared fixture and selection:**

```text
src/one.ts          export const value = 2;
src/two.ts          export const value = 1;
src/value.ts        symlink -> one.ts
src/value/index.ts  export const value = 1;
test/a.test.ts      imports ../src/value; asserts value === 1
```

Commit those files as the base. HEAD adds a comment to the test, so diff selection includes the base test. Coverage is enabled (`squeal.config.json` is `{}`). Use the real Vitest adapter and this candidate's real source CLI child. The fixture install links this worktree's Vitest, as the repository's tests do.

An honest `status --at <base> --run` returns **fail**, with the assertion named `value`. For each variant below, change only the checkout install, then call `status --at <base> --run` again:

1. **Outside link:** write an external module exporting value 1. Replace `src/value.ts` with a symlink to that module's absolute path, outside the checkout and fixture repository. Run `git update-index --assume-unchanged src/value.ts`.
2. **Deleted link:** remove `src/value.ts`, then run the same `update-index` command. Resolution now uses the already tracked `src/value/index.ts`, which exports value 1.

Both installs report an empty `git status --porcelain --untracked-files=no`. Both calls select, run and store one test. Both report the base side as **pass**, origin `run`, `stored: true`. A subsequent `--at` without `--run`, using the same altered install, reads that pass from the shared store with the base commit as provenance. The current side has no result, so the calls exit 3; that exit does not refuse or undo the wrong stored result.

| Case | Base commit | Honest run | Altered run | Later lookup |
| --- | --- | --- | --- | --- |
| Outside link | `60756a64ffed3bfd67477704d1be3057cfee4b50` | fail | pass; selected 1, ran 1, stored 1 | pass, origin `worktree` |
| Deleted link | `ef6bc4270b405449fa0f64fc8cb6e06a54f62344` | fail | pass; selected 1, ran 1, stored 1 | pass, origin `worktree` |

The honest key was `0192d7e2d78ad440e511196a5d2d1fe39a8921ce0321df1948b441f965f52cf7`. The altered outside-link key was `f4b587192b5d793122795d527077daa3fee1a9cd5c6c311370b71e3792e7c07a`; the deleted-link key was `7b7e478fe5abe409e6c52e6c8993a0ab97a66b972f77e05c46512e14551c89fc`.

These are changed-checkout runs stored and attributed to the named commit. This does **not** establish poisoning of the honest commit-content key: the altered keys differ. It proves the prohibited storage and attribution, even when the honest fail is already present in the store.

**One-worker repair:** Give one input verifier authority to refuse tracked resolution changes independently of the post-install closure. A detected changed or missing tracked link with no usable current target must not be cleared merely because its path is absent from that closure. Conservatively refuse the checkout or all possibly affected keys when its use cannot be established. Keep the comparison against the requested commit, independent of index flags and current HEAD. Add both fixture variants above, requiring zero runs and zero stored outcomes, the changed-path reason, and no later stored result from the altered checkout. Preserve the honest-run control and the existing byte, mode and internal-link cases.

## Verification at the exact candidate

Dependencies were already installed; no setup install was requested. Every direct check and probe below ran before this report was added, with `HEAD` at the requested SHA and a clean product tree.

| Check | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach bf901fc487bef0191aa8226404102ce689f8587a`; `git rev-parse HEAD` | Exact requested candidate. |
| `pnpm run lint` | Exit 0: `Checked 3675 files in 2s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0, `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0; all four plugin builds completed, no bundle drift or other working-tree changes. |
| `pnpm run check:version origin/main HEAD` | Exit 0: `0.1.550 -> 0.1.552, ok`; adapter `1.0.3 -> 1.0.3, ok`. Fetched main: `dbcb10609e331fcf55ed89d3183319ee667cf545`. |
| Initial affected Squeal wait | Exit 3 after 62.4 s: revision 7 not listed, 300 selected files pending, 3 current passes; new `status-at-run-inputs.test.ts` not listed. No known failures. This did not verify the candidate's new tests. |
| Second focused Squeal wait | Exit 3 after 61.5 s: revision 7 still not listed; review/key-format pending, boundaries pass, new input tests still not listed. |
| `pnpm run check:private` | Exit 0: `7613 added lines in 63 files ... ok`; warning: the private denylist is empty, so that rule was skipped. Repeated before the commit. |
| Final `squeal status --wait 60000` | Exit 0 but returned on timeout after 61.5 s at revision 9 (report edits): 973 affected test files pending; whole worktree 973 queued and 2 unknown, no known failures. This is not a passing affected gate. |
| Focused direct run below | Exit 0: **4 files, 28 tests passed**, 68.38 s. Used because Squeal could not give current evidence for revision 7 or the new input tests. |
| Independent probes | Exit 0. Hidden source rewrite, executable-mode change and internal-link retarget each read `not comparable (install changed src/value.ts)`, selected/ran/stored all 0. Honest input runs/stores pass. Both named gaps run/store pass; an additional honest baseline for each gap runs/stores fail, then each altered install still runs/stores pass and a later lookup reads it. |
| Cleanup | Each probe asserted that only its main worktree remained. Fixtures were removed. No product files were edited. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44187409026) | In progress at the last read. No local full suite ran. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44187408949) | Completed successfully for this candidate. |

The affected wait named `src/core/commit/at-keys-verify.ts`, `src/core/commit/at-keys-checkout.ts`, `test/cli/status-at-run-inputs.test.ts`, key-format and runner boundaries, using:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 <paths>
```

The focused direct run was:

```sh
timeout 600 pnpm exec vitest run \
  test/cli/status-at-run-inputs.test.ts test/cli/status-at-run-review.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

Standalone probes ran with `NODE_ENV=test timeout 600 pnpm exec tsx <temporary-script>.mts`. They used fixture repositories outside this worktree, `statusAtCommand`, the actual source CLI relaunch, real Vitest, the same environment for keying and running, and 600-second run budgets. Scripts were removed before committing.

## Notes, not additional blockers

- **Proven:** the new byte/mode/internal-link refusals show a file as `not comparable`, but JSON `run.notComparable` is 0. `atRun.use()` counts its state map, while the new changed-input reason remains only in the commit-side state. Include that new reason in the run count when fixing B5. This count does not bypass the successful refusals.
- The narrowed input set is intentional in this repair. This review does not claim that an unrelated changed tracked file affects a test, or reopen the settled project-outcome and environment questions.
- Full CI and broad affected coverage are verification limits, not findings against this wave.

## What fits and what must remain

The exact source rewrite from the second review is closed. The new mode and internal-link tests pass, and the independent cases agree. `inputCheckMs` is present and numeric in JSON, and is included in checkout time. The comparison reads the requested commit's tree and actual file data without trusting the worktree index. The new refusal propagates to sibling projects of the same run path. An honest checkout still runs and stores its result.

Preserve these properties and the previously reviewed environment, selection, budget, storage and process cleanup behavior. The remaining work is to make the input verifier handle the two unresolved-link cases conservatively before anything runs or is stored. The coordinator decides the next step under the repository's repeated-failure process.
