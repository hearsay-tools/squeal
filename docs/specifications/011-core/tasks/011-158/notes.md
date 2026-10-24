# 011-158: a path with no file enters no key

Worker f5dea904, 2026-10-24, wave 27 W2. Brief: the coordinator's W2 brief (parent run 04a258b0). Spec: 011 C3 (closures, the add rule, the key format), 001 D3 as carried there. Research: `research/missed-sharing.md` sections 2 (cause D) and 3. Alarm notes: `tasks/011-41/notes.md`.

## What changed

- `src/core/keys/check-key.ts`: `encodeSegment(path, null)` is `""`. A path with no file enters no segment, so a closure that names one keys as a closure that does not. The path stays in the closure and in the reverse index, so its add still re-keys the file at once, and a delete still re-keys it, since the segment leaves.
- `absentSegment(path)` gives the segment such a path had before this row, `path\0-\0`. `absentReadAsOne(environment, format)` gives the project's current environment hash under the definition before 011-158, while the format is 20 or below; a raise ends it.
- `src/core/keys/key-index.ts`: `KeyIndex.keysReadAsOne` keys every entry read as one with `absentSegment`, since every format and definition read as one (13 to 19, before 011-85, and 011-167's pnpm definition when it lands) predates this row. A key equal to the current one is left out: a closure with no absent path keys alike under both definitions.
- `src/core/scheduler/keying.ts`: `setEnvironments` puts `absentReadAsOne(hash)` first in each project's list read as one.
- `src/core/scheduler/bootstrap.ts`: no change. The start's first lookup still keys from the shared list; with absent paths out of the key, that lookup now finds the other worktree's row.

## Done-when, and the checks

| Done-when | Check |
|---|---|
| Two worktrees at equal content, one whose closure list holds a path only another branch has, get equal keys | `test/scheduler/absent-paths.test.ts`: a third branch adds `src/focus.ts`, imports it, runs and writes the shared list last; the observed set names it too. A lookup-only worktree at the first worktree's content keys the file equal, finds its pass at the first lookup, asks the runner nothing and runs nothing. It fails on the old encoding (`expect(b.keyOf(F0)).toBe(key)`). Units: `check-key.test.ts`, `key-index.test.ts` |
| Adding that path in either re-keys the file | Same test. Where the closure names it: the reverse index re-keys and the file runs. Where it does not: C3's add rule re-resolves the closure of an importer of `src/`, the runner names the file, it re-keys, and the pass the other worktree just stored stands. Unit: `key-index.test.ts` (add, then delete back to the old key) |
| The key-format alarm says whether a version moves | It fired for the global component and asks no raise (below). A new accept case runs the changed lines |
| The spec names it | Proposed C3 text below, for the coordinator |

## The alarm

Command: `TMPDIR=/tmp npx tsx test/keys/validity/compare-refs.ts squeal--v0.1.284 c78292eef`, 3.3 s.

```
squeal--v0.1.284 -> c78292eef, 3321 ms, fired: true (global 20->20 fired, vitest 3->3, node:test 9->9, pytest 3->3, recorder 3->3)
  key	golden key: keys differ, outputs equal
  key	golden key with a dependency segment: keys differ, outputs equal
  key	a trusted hidden lockfile: keys differ, outputs equal
  key	a stale hidden lockfile: keys differ, outputs equal
  key	an installed pnpm lockfile: keys differ, outputs equal
  key	an installed yarn state: keys differ, outputs equal
  (33 more cases of the rows, observe, accept, assemble and store kinds: keys equal, outputs equal)
  accept	a pass stored at a closure that names a path with no file: keys equal, outputs equal
wording: []
uncovered: 0
```

- **No version moves.** Every case with equal keys gives equal outputs, and no changed line is left unrun. The six `key` cases key apart: their closures name an absent path. That is a re-key, which C3 says moves nothing.
- **The new case** (`test/keys/validity/cases/accept/absent.ts`): the file's closure names its snapshot path, which has no file. Each tree stores a pass at its own key. The candidate's lookup over the release's store finds the row through `absentReadAsOne`. With that line removed from `keying.ts`, the alarm fails: "equal keys, different outputs at squeal--v0.1.284 and the candidate; raise KEY_FORMAT_VERSION". So the read is what keeps the format.
- **Harness changes for the case:** `AcceptInput.absent` (paths with no file the closure names), passed to `keyedOver`, which now calls `trackUntracked()` after `setClosure`, as a daemon does. Without it an absent path is untracked and the file has no key.

## Which stored results the change invalidates

None, through the read as one, since the repair of review 0.1.285 B1 (below); before it, a file whose start re-check dropped a branch-only absent path lost its pre-upgrade row. Without the read, all of them. On a store copy taken 2026-10-24 04:55Z (`~/projects/squeal/.git/squeal/store.sqlite` with `-wal` and `-shm`, read with `node:sqlite` read-only, against `git ls-tree main`):

| Count | Value |
|---|---|
| Test files at main with a stored closure list | 1,003 |
| Of them, a list that names a path with no file at main | 1,003 (547 only a snapshot path) |
| Absent paths in those lists | 7,162 |
| Non-snapshot absent paths that exist on some other branch or remote ref (478 refs) | 67, for example `src/core/keys/pnpm-graph.ts`, `src/cli/run-skipped.ts` |
| Test files whose list names one of those 67 | 121 |
| Of them, through the observed set, which never prunes | 38 |

- **Every key moves at upgrade.** So every file's first lookup after the upgrade misses at its new key, reads the key before 011-158, and copies the newest set (`copyNewest`), once per file, as 011-90 did. Test: `former-sibling.test.ts` with a real Vitest closure, whose snapshot path is absent; it needed `absentSegment` in its helper, since 0.1.252's key held it.
- **The 121 files** are cause D at this snapshot: a worktree at main's content keyed them apart from a worktree whose list did not name the path. They now key equal.
- **Not measured here:** a bundle-level key comparison (E3 of the research). This row builds no bundle, and the research's E0 says a tsc build keys apart from the shipped one. The alarm bundles the validity path as the shipped bundles are built, and its accept case is the bundle-level proof of the read. An E3-style run belongs on the candidate after its build.

## Repair: review 0.1.285 B1

Brief: the coordinator's resume of 2026-10-24, from `reviews/0.1.285.md` B1 (the reviewer's draft).

- **The defect.** `copyReadAsOne` (`src/core/scheduler/accept.ts`) read the keys read as one once per file and key. Since this row a closure change can move the key before 011-158 while the current key stays equal: a path with no file leaving the closure moves only the former. At start, the first lookup keys a file from the shared list, which another branch wrote with a path only it has; the re-check keys it from the own closure, which drops that path. The current key is equal, the key before 011-158 is now the key of the pass stored before the upgrade, and the memo skipped the read. Under `lookup-only` the file stayed without a result and nothing ran.
- **The fix.** The memo holds the key and its keys read as one, joined (`readAt`), so a file is read once per key and keys read as one. An unchanged miss is still read once. The copy is unchanged: `copyNewest` fills an empty key only. `ReadAsOne.read` is `Map<string, string>`; `Ledger.#readAsOne`'s type and comment follow, by the coordinator's agreement (request 106f6c63).
- **The regression**, `test/scheduler/absent-read.test.ts`: a pass stored an hour before the start (past `STORED_KEYS_OVERLAP_MS`, so `StoredKeys` does not read it again) under F0's key before 011-158, over its own closure, F0 and its absent snapshot. The shared list adds `src/branch-only.ts`. The lookup-only start's second lookup reads the own closure's keys, copies the pass with its provenance and runs nothing. F1, a miss whose lists are equal, is read once. It fails on the old memo (`passing` 0) and on a fix that drops the memo (F1 read twice). With the row stored 60 s before the start, `StoredKeys` reads it again and the old memo passes, so the hour matters.
- **Unit tests**, `test/scheduler/accept.test.ts`: a miss is read once per key and keys read as one and again when only those move; once rows stand at the key nothing is read or copied; a copied fail of another worktree stays held and nothing is copied over it. The first fails on the old memo.
- **The contract changes.** Proposed C4 step 3 text, in place of "once per file and key in a daemon": "once per file, key and keys read as one in a daemon: a closure change can move the keys read as one while the key stays, as a path with no file leaving the closure moves only the key before 011-158 (task 011-158, review 0.1.285 B1), and the file is read again at the keys it moved to".

## Proposed spec text (011 C3), for the coordinator

1. **Closure bullet**, in place of "Absent paths hash as absent, so the key changes the moment such a file appears, incrementally and at bootstrap.": "A path with no file stays in the closure and the reverse index and enters no key (task 011-158): closure lists and observed sets are shared per project, so a path only another branch has would otherwise key equal content apart (`research/missed-sharing.md`, cause D). The key changes the moment such a file appears, incrementally and at bootstrap, since its entry enters, and when a file is deleted, since its entry leaves."
2. **Check key bullet**: "sorted (path, fileHash) over the closure's paths that have a file".
3. **Key format bullet**, after the pnpm definition's paragraph: "The key definition before task 011-158 is read the same way: every key read as one holds each absent closure path as `path\0-\0`, since every format and definition above predates it, and a lookup that misses also computes the key so at the current format, and copies the newest set found as for a format read as one. Every input of the current key is a function of those, so such a row means what a row under the current key means. A raise empties it with the list."

## Decisions the brief did not settle

1. **Absent paths stay in the closure.** Only the key leaves them out. So the add re-keys at once through the reverse index, as before, and C3's add rule is needed only where the closure never named the path, also as before.
2. **`KEY_ENCODING` stays `squeal-check-key/2`.** A raise of it would re-key the closures with no absent path too, and the read as one would need the old encoding for every entry. A new key can equal an old key only of a closure that named the same present paths with the same bytes, and such a row means the same.
3. **The read lives in `check-key.ts`, `key-index.ts` and `keying.ts`, not `former.ts`.** Rows 011-165 to 011-167 edit `former.ts`; this keeps the two candidates apart.
4. **Every entry read as one gets `absentSegment`, with no per-entry flag.** All of them predate this row. A later definition read as one, after this row, needs a flag on `ReadAsOne`.

## Type changes

- Repair B1: `ReadAsOne.read` (`src/core/scheduler/accept.ts`) is `Map<string, string>`, was `Map<string, CheckKey>`; `Ledger.#readAsOne` follows. `CheckKey` is `string`, so no caller's type moved.
- New in `src/`: `absentSegment(path)` and `absentReadAsOne(environment, format?)` in `check-key.ts`; `absentReadAsOne` exported from `src/core/keys/index.ts`.
- Changed meaning, not type: `encodeSegment(path, null)` returns `""`.
- Test-side: `AcceptInput.absent?: readonly string[]`; `keyedOver(testFile, installed, root, absent = [])`.

## What the next worker must know

- **Row 011-167 (pnpm read as one) stands.** This row raises no format. Its entries are keyed with `absentSegment` by `KeyIndex`, which is right for its rows (stored before 0.1.282). When the two candidates meet, a test that computes a former key with `encodeSegment` over a closure with an absent path must use `absentSegment`, as `former-sibling.test.ts` does now.
- **Bundle drift.** `npm run build` was not run, so the four bundle tests fail as expected: "cli/squeal.mjs differs from the build".
- **The scratch files** of the measurement (`count-absent.mjs`, `count-branch.mjs`, the store copy) are in the task's scratch directory `t/f5dea904`, outside the repository.
