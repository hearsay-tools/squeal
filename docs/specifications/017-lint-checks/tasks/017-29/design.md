# 017-29 design: a closure input a lint call first reads keys only what follows it

Worker 5ab27eae, 2026-11-06, from main 0.1.409. Brief: `../wave-6.md` W1. Cause: `../../../011-core/research/issue-154-cause.md` F4.

## Today

Every lint key holds the blob of every config file and closure file (`lintKey`, `configInputs` in `keys.ts`). The cursor's environment (`environmentOf`) hashes the same closure. A rule that reads a file lazily makes the worker hold it (ESLint: `held`, cumulative for the thread; oxlint adds it to its closure); `session.observe` joins it to the closure (P3). `grown()` then finds a path the part's keys lacked: the part stores nothing (correct), the pass ends, and the next `planOf` sees the environment moved: mode `config`, every check gets a new key and lints again. One full re-key per lazily read input. A restart adds one more, because a new thread holds none of them and the closure first shrinks.

## The rule

A closure input that a lint call read first joins the keys from its part on. It does not move the key of a check judged before it.

Validity (011 C4, D5 "The bytes ESLint used"): the worker's reads are cumulative per thread, and a result is stored only when the report after its call names no closure input its key lacks. So a check judged before the input's first read was linted by a thread that had not read it; its result does not depend on it. Once the input is in the cursor's recorded inputs, a change to its bytes moves the environment and re-keys every check, those judged before it included (conservative, as today).

Changes, all in `src/core/lint/pass/`:

1. `session.ts`: `observe` records the closure paths a lint report added (`readByLint`). The set empties when a provider opens or refreshes at `thread`.
2. `rekey.ts` `planOf`: when the environment moved, read the cursor's inputs record (019-21, written with every keying). If every closure path the record lacks is in `readByLint`, and the environment over the closure without those paths equals the cursor's, the mode is `edit`: key the revision's changed files only, and write the new environment and inputs record (also when nothing changed since the cursor). A shrunken closure, a recorded input at other bytes, a config file, the packages, or a read at a refresh (the config loading a new file, which can change computed configs) still make `config`.
3. `lint-part.ts`: unchanged. The grown part's files stay `pending` and lint at the grown keys in the next pass, so each input costs at most one part (16 files). An edited file in that part keeps its transition (today the `config` keying made it quiet).

No lint key format changes (`LINT_KEY`, `lintKey`, `environmentOf` as they are); `key-format.test.ts` is not affected. Type changes: a `readByLint` getter on `ProviderSession` and one field in `RekeyContext`, both internal to the pass.

## Tests (`test/lint/pass/grown.test.ts`, new)

Fixture: 40 files; rules read `rules/one.json` when they lint a file with `uses one` (part 1) and `rules/two.json` for `uses two` (part 2): one input per pass. The fake provider gets a `lazy` map in `helpers.ts`. "Keyed" is counted as `first`/`config` keyings (every check gets a key) and lints per file.

- First run: one `first` keying, no `config`; each file linted at most twice. Red today: 2 `config` keyings, part 1's files 3 lints.
- Restart at the same revision (new provider): one `config` keying (the closure shrank), each file linted at most once. Red today: 3 `config` keyings.
- Validity: an edit of `rules/one.json` that turns its rule on gives a `config` keying; every file lints again; the file that reads it fails.

Two existing assertions encode the old cascade and change; no validity assertion changes. `program.test.ts` "a file the config loaded": modes `["first", "config"]` become `["first", "edit"]`; its calls and the second worktree's miss stay. `errors.test.ts` "a lint report's grown closure keys again quietly": last mode `config` becomes `edit`; title changes. `keys.test.ts` "a file the config loaded" (closure grown at a refresh) stays `config`.

## Rejected

- Join a new input only to the keys of the checks whose call read it: a rule caches what it read, so a later file uses it without a read. Unsound.
- Store the grown part's results at the grown keys: saves one part's lint, but an input outside the listing has no blob yet at that point (`Unlisted` reads at `ready`).

## Question

Option P: when a provider opens or refreshes at `thread`, join the cursor's recorded closure to the new snapshot. A restart would then key nothing at all (today 1 + N keyings, with this design 1), at about 15 lines in `session.ts` and `run.ts`. Cost: a learned input leaves the closure only at a config change. Default: not in this row; a follow-up row if the restart keying matters.

## D5 sentence to amend (for the coordinator)

After "A project file the worker read that no key holds joins the closure, listed or not.": "One that a lint call read first joins the keys from its part on: a check judged before it keeps its key, since no lint before it read the file; a later change to its bytes re-keys every file (row 017-29)."
