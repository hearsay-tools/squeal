# Wave 5 third review

FAIL `f6d137bab6f4583b28ccb475f7744196f88fa604`

**1 proven blocker remains: B1, with two reproduced resolution cases. B2 and the concrete B3 case remain closed. No new should-fix items or nits.** This review covers the approved structural-rule repair and declared-input delta only. No product code changed.

The candidate is version 0.1.543. The repair range is `432fcd2995..f6d137bab6`: `b2f172ed74`, `96d7e20d23`, `ed0a3824ff`, and notes. The repository history was rewritten before this review. Prior findings were read from the rewritten docs-only commit `9a59c93527`; its `wave-5-rereview.md` is absent from the candidate tree. Earlier results are context, not verification at this candidate.

## Blocker

### B1. Proven, still open: the structural filter does not establish resolution equality

**Contract:** Wave 5's outcome is “the exact key a fresh walk at that commit gives, or `not determined` with a reason.” D2 makes the checkout walk the authority. The structural rule removes extension lists and fixes the original `.ts` and `.custom` fixtures. It still accepts a current key for an older commit when the resolver loads a different file there. The checkout environment agrees in both cases below, so the environment check cannot repair the accepted key.

**Locations:** `src/core/commit/at-keys-fast.ts:189` guards only each closure file's folder and its immediate parent. Lines 109–112 apply that guard only to additions and deletions. `src/core/commit/at-keys-diff.ts:77` excludes modifications and type changes from that set. `src/core/commit/at-keys-checkout.ts:94` accepts the current key after environment equality.

#### Case A: a folder manifest selects a deeper entry file

At both A and B:

```js
// vitest.config.mjs
export default {
  resolve: { extensions: [".custom", ".ts", ".js", ".json"] },
  test: { include: ["test/**/*.test.ts"] },
};
```

```ts
// test/deep/a.test.ts
import { it, expect } from "vitest";
import { n } from "../../src/a";
it("n", () => expect(n).toBe(2));
// src/a/lib/deep/entry.custom
export const n = 2;
```

`src/a/package.json` is unchanged and contains `{"main":"./lib/deep/entry.custom"}`. A also holds `src/a.custom`, exporting `n = 1`; B deletes only that sibling file.

At A the import loads the sibling. At B it loads the manifest's entry. The latter's folder and parent are `src/a/lib/deep` and `src/a/lib`. The removed sibling is in `src`, beyond that guard. The manifest has not changed, so condition 7 does not reject it. This is the same file-versus-folder resolution premise as B1, with the folder's supported `main` entry instead of its direct index.

```text
fresh A:            94897252e6de7b0e242c27a394af9462d2832e4953997e6fbd7350fa963d73f1
fresh B:            6e9610e1c789419b90830abd3ce628e3b23d4fe280a50a7c86cf2156501f971f
keysAtCommit(A):    B key, via unchanged, stored [pass], changed []
sideKeys(A):        A key, via walk, stored [fail]
real test at A:     exit 1, AssertionError: expected 1 to be 2
real test at B:     exit 0, 1 passed
```

#### Case B: a tracked directory symlink changes target

The same test imports `../../src/chosen`. Both commits hold unchanged `impl/one/index.ts` exporting `n = 1`, and `impl/two/index.ts` exporting `n = 2`. At A, tracked `src/chosen` links to `../impl/one`. At B, only that link changes, to `../impl/two`. Configuration uses the ordinary extensions.

Vite resolves the link to the target file. The changed link is outside the current closure's file paths. Git reports a modification, so the new structural addition/deletion guard does not inspect it. Both target blobs, the test and the environment remain equal between the commits.

```text
fresh A:            524577f35dd4fe759e22cee0ecd7bda746d760ed2aaa3738aefeb1aa226df0ee
fresh B:            e13ab720b6c2c46d16f008b501af60f6234629af13e7cda8aa9578154ab5bcc8
keysAtCommit(A):    B key, via unchanged, stored [pass], changed []
sideKeys(A):        A key, via walk, stored [fail]
real test at A:     exit 1, AssertionError: expected 1 to be 2
real test at B:     exit 0, 1 passed
```

For each case the probe independently walks A and B in plain detached worktrees, seeds a failure at A's key and a pass at B's, then asks for A from B through both APIs. The real test runs separately establish the assertion failure and pass. The lookup and side calls leave database bytes unchanged and remove their checkouts. These are wrong passes, not only conservative-filter or performance concerns.

**One-worker fix:** Keep resolution equality under one owner. Make the fast-path acceptance proof conservative for manifest-selected entry paths and changed directory links. If that proof is unavailable, use the checkout walk that already returns the exact key. Do not add extension names or a fixed directory depth. Add both real-adapter cases, including seeded result lookup, while retaining the passing original cases and an ordinary unchanged case. The coordinator must resolve this failed structural premise before dispatching further repairs under the repository's repeated-failure rule.

## Verification

All product checks and probes ran at the exact candidate with a clean tracked tree. The build had no tracked bundle drift. Dependencies were already installed; setup was not repeated, as instructed. Probe source and fixtures lived outside the worktree and were removed before the findings-only commit. No full suite or full-suite checkpoint was requested.

| Command or evidence | Actual output/result |
| --- | --- |
| `git fetch --prune origin && git checkout --detach f6d137bab6f4583b28ccb475f7744196f88fa604` | Exit 0; `git rev-parse HEAD` exactly matches the requested candidate |
| `git status --short`, before checks and after build/probes | Empty |
| `pnpm run lint` | Exit 0: `Checked 3618 files in 1824ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: TypeScript and all four harness builds completed; tracked tree stayed clean |
| `git diff --check b2f172ed74^..HEAD` | Exit 0, no output |
| Squeal nine named tests, command below | Exit 0 after 2.5 s: `9 test files, each with a current result`, no known failures, revision 13. Worktree: 467 of 1919 files not current. Inherited results count by content key; this is not a fresh full-suite claim. |
| Squeal affected sources, command below | Two waits exited 3 after 60.9 s and 61.1 s: 143 selected, 109 current pass, 34 pending, no known failures. The second wait still awaited tier completion. Broader affected coverage is **unverified**. |
| `timeout 600 pnpm exec vitest run --config <probe>/vitest.config.mjs` (initial probe) | Exit 1: 6 failed, 11 passed, 37.02 s. Four failures were invalid probe expectations: unsupported negated input globs caused the policy inputs to be rejected. Those are not candidate findings. |
| Same direct command, after using supported brace globs and asserting reference keys differ for relevant declared-input changes | Exit 1: **2 failed, 15 passed**, 33.14 s. Only B1 cases A and B failed. Original B1 `.ts`/`.custom`, B2, B3 and structural/declared-input controls passed. |
| Same direct command with `--reporter=verbose -t 'B1 folder main nested\|symlinked folder retarget'` | Exit 1: **2 failed, 15 skipped**, 8.66 s. Captured real A assertion failures and B passes; exact reference keys and wrong lookups agree with the preceding run. |
| `pnpm run check:private`, before findings commit | Exit 0: `private: 2374 added lines in 64 files over 1de1a791188c0eea0b486a1e50d334b2515a79d1, ok`. Warning: local private denylist is empty, so that rule was skipped. The scanner reads committed HEAD; staged review text is checked separately for home paths. |
| `gh run list --commit f6d137bab6f4583b28ccb475f7744196f88fa604 --json databaseId,name,status,conclusion,headSha` | Exact-candidate [CI 44075365090](https://github.com/hearsay-tools/squeal/actions/runs/44075365090) **pending**; [Private material 44075364812](https://github.com/hearsay-tools/squeal/actions/runs/44075364812) **queued**. |
| `gh run view 44075365090 --json headSha,status,conclusion,jobs` | Seven Node 22/24/26 jobs queued; nightly and version-bump jobs skipped. Full-suite CI is **unverified**, not a blocker. |

The probe folder was `~/projects/squeal/.ai/squawk/t/51f5d4df/sq-third-review-2froypz2`. Commands used its expanded path. Key fixtures reuse the documented real-adapter `freshKey` reference and Vitest link install. The kill fixture runs real default `npm ci`, held in preinstall. Direct tests discriminate the requested boundary failures; they do not repeat the covered candidate suite.

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  test/commit/at-keys-fast.test.ts test/commit/at-keys-resolution.test.ts \
  test/commit/at-keys-killed.test.ts test/commit/at-keys.test.ts \
  test/commit/at-keys-untracked.test.ts test/checkout/group.test.ts \
  test/keys/key-format.test.ts test/version-sensitive.test.ts \
  test/runners/boundaries.test.ts

"$SQUEAL" status --wait 60000 \
  src/core/commit/at-keys.ts src/core/commit/at-keys-fast.ts \
  src/core/commit/at-keys-diff.ts
```

## What fits

- Original B1 `.ts` and configured `.custom` direct-index probes now return the exact A key and stored failure through both entries. Root-level custom siblings and a case-only sibling rename also return the exact A key via walk on this case-sensitive Linux filesystem.
- Additions, removals and renames of folders under a guarded parent send the file to a walk, even when its key ultimately stays equal. This validates `entryFolders` propagation for those cases.
- Per-test declared-input controls pass for add, delete, modification and rename of selected files. A brace glob selects deep files; each relevant change gives different fresh A/B keys and the lookup returns A's. Changes to files selected only for another test, and files outside the applicable glob, retain the exact key via unchanged. The unsupported-negation probe was corrected before drawing these conclusions.
- B2's unchanged config reading changed `choice.txt` still causes an environment mismatch and returns A's exact key. No B2 boundary changed in this delta.
- B3's original injected-install kill and real default npm preinstall kill both pass. The next lookup stops the recorded install group, removes the dead owner's checkout and leaves only the fixture's main worktree. The earlier plausible spawn-before-marker window remains outside this delta; it was not re-prosecuted.
- `sideKeys` returns each reference A key, including both failing B1 cases. Shared-store hashes remain unchanged in the key probes, and no owned probe lookup/install child remains.

## Should-fix and nits

None beyond B1. The earlier note that D2 and the fast-helper preamble still describe reuse without a checkout remains a documentation input when this review is folded. Actual behavior still creates and installs a checkout for every request with a present file, including `via: unchanged`.

## Inputs for the next wave

Retain the API and uncertainty behavior documented in `tasks/023-16-notes.md`. Future callers must treat `via: unchanged` as “no target closure walk,” honor each `notDetermined`, and use `checkoutMs`, not the old boolean. The 300 s install default and future 600 s total orchestration budget are unchanged.

The reported fast-path share is a worker measurement, not reproduced here. It does not establish key equality for B1's two cases. Neither side's stored pass may be presented as current at the requested commit until the resolution proof is sound. Keep B2/B3 closed unless their interfaces change; concentrate a new review on B1 and the resulting delta.
