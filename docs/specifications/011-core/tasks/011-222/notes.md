# 011-222: notes (wave 46 W5, 2026-10-26)

The validity harness no longer reads code where it was before row 011-40's and row 011-47's moves. The comparison against the last release gives the same result as before. The oldest baseline the harness compares is now `squeal--v0.1.232`. For an older window, run `compare-refs.ts` from a worktree at `eec505f3b`.

## Cause

`bundle.ts` let a tree that predates a move bundle the candidate's harness. `BEFORE_MOVES` swapped three harness modules (`accept-rule.ts`, `store.ts`, `barrier.ts`) for fallbacks that asked the same of the old code (`accept-rule-ledger.ts`, `store-traced.ts`, `barrier-scheduler.ts`). `ENTRIES_BEFORE_MOVES` read `accept.ts` as `ledger.ts` and `store-decision.ts` as `tiers.ts`. `pinFormat` also blanked the `KEY_SOURCES_HASHES` table of a release before row 011-41. Each was to go once the last release carried the move (011-40 and 011-41 notes, review 0.1.232). The first release with all three moves is `squeal--v0.1.232`. The last release is `squeal--v0.1.332`, so 015-58's research found the 40 fallback functions run in no process.

## The first step, measured

The brief's first step said that `compare-refs.ts`, from the oldest tag it still compares, needs none of the fallbacks. That was false. With the harness at `eec505f3b`:

- Every tag from `squeal--v0.1.199` to `squeal--v0.1.231` bundles the driver and all five entries only through the fallbacks. `squeal--v0.1.168` and older already fail to bundle.
- `compare-refs.ts squeal--v0.1.231 HEAD accept store` ran all 21 cases, every one with equal keys and outputs, none thrown.
- From `squeal--v0.1.232` on (84 tags, the last release among them), no bundle reads a fallback, and no `key-format.ts` has `KEY_SOURCES_HASHES`.

So the removal moves the oldest comparable baseline from 0.1.199 to 0.1.232. Request `1d91b40e` asked the coordinator. The coordinator chose to remove everything, the pin-table clause too, and to state the new floor here and in `test/keys/validity/notes.md`.

## Change

- `bundle.ts`: `BEFORE_MOVES`, `beforeMove`, `ENTRIES_BEFORE_MOVES` and `inTree`'s fallback are gone. `pinFormat` pins only `KEY_FORMAT_VERSION`.
- Deleted: `harness/accept-rule-ledger.ts` (with format 12's probe-arity branch), `harness/store-traced.ts`, `harness/barrier-scheduler.ts`.
- `harness/barrier.ts`, a one-line re-export that existed only so the bundle could swap it, is folded: `store-input.ts` imports `barredByTouch` from `stability.ts`. This was not in the brief. The driver bundle's text is unchanged by it (below).
- Comments that named the fallbacks: `harness/accept-rule.ts`, `harness/store.ts`, `entries/global.ts`.

## Evidence

Host load 12 to 29 on 24 CPUs, the host's own load and these runs.

**The done-when comparison**, `env -u PLUGIN_ROOT -u PLUGIN_DATA node --import tsx test/keys/validity/compare-refs.ts squeal--v0.1.332 HEAD`. The two trees have no `src/` difference, so no alarm fires and no case runs.

Before (`eec505f3b`):

```
squeal--v0.1.332 -> HEAD, 192 ms, fired: false (global 20->20, vitest 3->3, node:test 10->10, pytest 4->4, recorder 4->4)
wording: []
uncovered: 0
```

After (the fix's working tree, `src/` at `eec505f3b`):

```
squeal--v0.1.332 -> HEAD, 413 ms, fired: false (global 20->20, vitest 3->3, node:test 10->10, pytest 4->4, recorder 4->4)
wording: []
uncovered: 0
```

**Bundles, byte for byte.** `probe-bundle.ts` (beside these notes) bundles the driver and the five entries at a tag with a given worktree's harness. It prints a hash of each bundle's text and the fallbacks its source map reads. Run as `node --import tsx docs/specifications/011-core/tasks/011-222/probe-bundle.ts "$PWD" <tag>...`. At `squeal--v0.1.232`, `v0.1.300`, `v0.1.332` and `HEAD`, all 24 hashes are the same before and after, and no bundle reads a fallback. At `squeal--v0.1.231`, the driver and the global entries now fail ("Cannot read file: …/src/core/scheduler/accept.js"), as decided.

**A comparison that fires**, from the floor. `compare-refs.ts squeal--v0.1.232 HEAD accept store`, before and after: the 21 case lines, the 14 own-decision lines, `wording: []` and `uncovered: 2017` with its per-component lines are identical. Only the timing differs (4,196 ms, 5,043 ms). After the change, `compare-refs.ts squeal--v0.1.232 HEAD` with every kind ran 103 cases in 28,944 ms, none thrown. Six cases have different outputs, and `uncovered` is 472. These are the 100 releases' changes, not this row's: the bundles are the same as before.

## Checks

- `npm run lint`: `Checked 2225 files in 1021ms. No fixes applied.`
- `npm run typecheck`: no errors.
- `env -u PLUGIN_ROOT -u PLUGIN_DATA squeal status --wait 60000` on the nine changed paths: `Selected: test/keys/validity/self-test.test.ts` (it reads `bundle.ts`); "no known failures; 1 test file, each with a current result, after 34.5 s". It named no test file for the harness modules ("no test file's closure holds …"): esbuild reads them in a Go process (011 C12). That is the gap row 011-233 researches.
- So `test/keys/` ran directly, `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/keys/`, at a load of 21 to 30: `Test Files  33 passed (33)`, `Tests  280 passed | 2 expected fail (282)`, 65.55 s. It ran on the working tree whose bytes `9f540042d` commits.

## Commits

- `9f540042d` test(011-222): the validity harness drops its pre-move entries
- this docs commit: the notes and `test/keys/validity/notes.md`

## For whoever continues

- A one-off on a window older than `squeal--v0.1.232` (the 12→13, 15→16 and 17→18 windows in `test/keys/validity/notes.md`) needs the harness at `eec505f3b`: `git worktree add <dir> eec505f3b`, then run `compare-refs.ts` there.
- The next fallback of this kind follows the same rule: add it with the move, and remove it once the last release carries the move.
