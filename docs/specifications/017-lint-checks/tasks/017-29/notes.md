# 017-29 notes

Worker 5ab27eae, 2026-11-06. Design: `design.md` (approved by coordinator e30ed1a7, 2026-11-06, with additions (a) and (b) below). Code: `src/core/lint/pass/{grown.ts,rekey.ts,session.ts,run.ts}`; tests: `test/lint/pass/{grown.test.ts,lazy-rules.ts}`.

## What changed

- `session.ts`: `observe` records the closure paths a lint report added (`readByLint`). The set empties when a provider opens, at a `thread` refresh, and when a report's closure lost a path (a new thread inside the provider, as `EslintProvider.start` makes after a failed thread).
- `grown.ts` (new): `grownByLint` reads the cursor's inputs record (019-21). The environment moved only by lint-read paths when every closure path the record lacks is in `readByLint`, and the environment over the closure without them equals the cursor's.
- `rekey.ts` `planOf`: such an environment keys as `edit`, and is written even with no revision since the cursor.
- `run.ts`: passes `session.readByLint` to the keying. `onKeying` (011-302) is unchanged.
- `lint-part.ts`: unchanged. A part whose report adds a closure path still stores nothing for its files; they lint at the grown keys in the next pass.

## Restart cost

With N lazily read inputs, a restarted daemon on an unchanged worktree:

- Today: 1 + N full keyings. The new thread holds none of the inputs, so the closure first shrinks (`config`), then each lint-read input makes another `config` keying.
- With this row: 1 full keying (the shrink), then each input costs one part (at most 16 files) linted again. `grown.test.ts` "after a restart" shows `["config"]` and each file linted at most once.

## Option P (follow-up, not this row)

Sketch: when a provider opens or refreshes at `thread`, `ProviderSession` joins the closure paths of the cursor's inputs record (`readInputs(...).files`, less the config files) to the new snapshot, as `#extend` joins held paths. `run.ts` would hand the record to `session.ready`. The keys of a restarted daemon then equal the ones before the restart, the environment equals the cursor's, and a restart keys nothing. About 15 lines in `session.ts` and `run.ts`. Cost: an input a lint call once read stays in every key until a config change re-keys with what the new thread reads; its edits re-key every check meanwhile. Validity holds: a key that holds more inputs than its lint read is conservative.

## One lint thread per tool (coordinator's addition a)

The pass never lints two parts at once, so no two threads read concurrently:

- `src/core/lint/pass/index.ts:173`: a nudge during a pass only sets `again`; passes never overlap.
- `src/core/lint/pass/parts.ts:115` and `:129`: the parts run one after another, each awaiting its `lintFiles`.
- `src/core/lint/pass/session.ts:56`: one provider per session, and one session per tool (`index.ts`).
- `src/core/lint/provider/eslint-provider.ts:198` and `:259`: the ESLint provider keeps one live thread and runs its calls serially.
- `src/core/lint/provider/oxlint/provider.ts:144`: oxlint runs with `--threads 1`, one process per call; its closure keeps every path a run read.

So the two-thread case runs sequentially: `grown.test.ts` "a new thread inside the provider" starts a new thread before part 2's second call and again before part 3's. Part 3's files are keyed with `rules/one.json`, which their own thread had not read (conservative). `unheld()` checks every stored result: its key holds each input its own thread had read by the end of its call. A second worktree whose `rules/one.json` differs gets no hit.

## Validity case after a restart (coordinator's addition b)

`grown.test.ts` "after a restart" edits `rules/two.json` after the restart, then `rules/one.json`. Each edit gives one `config` keying, and the files that read the input fail. Correction to `design.md`'s validity line ("every file lints again"): an edit re-keys every check whose key holds the input. A lint-read input is a closure file, so its edit also refreshes the worker at `thread`, and the new thread reads the inputs again. Measured after the `rules/two.json` edit: part 1 lints once at the shrunken keys, reads `rules/one.json` and stores nothing, then hits its results at keys that hold `rules/one.json` only (made before `rules/two.json` was read); parts 2 and 3, whose keys hold `rules/two.json`, lint at its new bytes. The edit of `rules/one.json`, which every key holds, re-lints all 40 files.

## Existing assertions changed (accepted by the coordinator)

- `test/lint/pass/program.test.ts`, "a lint report that names an input its keys did not hold", case "a file the config loaded": modes `["first", "config"]` became `["first", "edit"]`. Its calls and the second worktree's miss are unchanged.
- `test/lint/pass/errors.test.ts`, "a failing file deleted is resolved once; a lint report's grown closure ...": the last mode `config` became `edit`. The title said "keys again quietly"; it now says "lints its part again with no full keying (row 017-29)".

## Decisions the spec did not settle

1. `readByLint` empties when a lint report's closure lost a path, not only at `open` and `thread`. The ESLint provider can replace its thread without the pass knowing; the set then means "read first by a lint call of this thread".
2. A grown keying is reported as mode `edit` with `keyed: 0`. No new mode and no D8 keying record: no check was keyed again.
3. An edited file in the part that read a new input keeps its transition (`grown.test.ts`, the `uses three` case). Before, the `config` keying made it quiet.

## Type changes

All are inside `src/core/lint/pass/`. `RekeyContext` gets a required `readByLint: ReadonlySet<RelativePath>` (one constructor, `run.ts`). `ProviderSession` gets a `readByLint` getter. `grown.ts` exports `grownByLint`. `LINT_KEY`, `lintKey` and `environmentOf` are unchanged, so no lint key changes.

## D5 sentence to amend

After "A project file the worker read that no key holds joins the closure, listed or not.": "One that a lint call read first joins the keys from its part on: a check judged before it keeps its key, since no lint before it read the file; a later change to its bytes re-keys every check whose key holds it (row 017-29)."
