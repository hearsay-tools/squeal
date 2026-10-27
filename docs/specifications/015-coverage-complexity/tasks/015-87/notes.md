# 015-87 notes: keep the code settings through a config that does not parse

Worker d97c38c5, 2026-10-27, from `tasks/wave-23.md` W1. Shape: repair. Baseline `8e3e616b6` (released 0.1.365 plus docs). Spec: D1 as amended 2026-10-27; 011 C10, *Projects at a reload*.

## Answer

A `squeal.config.json` save that cannot be read, is not JSON or is not an object now keeps the last good `complexity`, `coverage` and `crap` settings, beside the `nodeTest` and `pytest` projects it already kept (row 011-78). Before, it took the defaults for those three sections. With coverage on, that re-keyed every check whose key holds coverage, and the good file again re-keyed them back, so each file ran twice. Every other key still takes the defaults at such a save, as before. A valid file still applies every key.

## Commits

- `b95e6af19` test: one entry, `test/daemon/reload-coverage`, in `test/version-sensitive.txt` (by agreement with coordinator 8b2a8995, reply 34b229c8).
- `12c356311` fix: `src/core/daemon/daemon.ts` `#reloadPolicy` and its comment; new `test/daemon/reload-coverage.test.ts`.

## Seam (as built)

- `src/core/daemon/daemon.ts` `#reloadPolicy`: `loadPolicy` returns `unparsed: true` for the three bad-file cases (`config-file.ts`). Then the method spreads the current policy's `nodeTest`, `pytest`, `complexity`, `coverage` and `crap` over the loaded defaults. No type changed.
- Readers of those sections see the kept values with no further change: the node:test coverage gate (`coverage.coverageOn(this.#policy)`, read at each `environment` and `invalidate`), the Vitest adapter's `enabled`, the code pass's cursor (`complexity.threshold`, `include`, `exclude`, `maxFileBytes`) and the coverage step (`crap.*`, `coverage.untested`, `coverage.exclude`).

## Tests

`test/daemon/reload-coverage.test.ts`, through a real daemon with one node:test project (the `reload-projects-kit.ts` fixture, unchanged) and one counted source, `lib/pick.mjs` (complexity 4, no test loads it, so CRAP 20 and untested fail):

| Case | Good config | Red before the fix |
| --- | --- | --- |
| 1 | coverage on, `complexity.threshold` 3, `crap.threshold` 15 | both test files re-keyed at the bad save |
| 2 | coverage on, `complexity.threshold` 3, `crap.enabled` false | both test files re-keyed at the bad save |
| 3 | coverage off, `complexity.threshold` 3 | the code pass judged by threshold 20; `pick` went to pass; a `threshold` recount was recorded |
| 4 | coverage off, then a valid coverage-on save, then the coverage-off file again | passed before the fix too: both keys move once and both files run once more; the keys come back; the daemon's `startedAt` and token stay (no restart) |

Cases 1 to 3 save `{ "nodeTest": [], }` (a trailing comma), then the original file. After each save the test waits for the reload note and for `squeal status --wait` to report quiet, then compares each file's key, each test's run count, the code pass cursor's threshold, the last recount record and `pick`'s states with the values before the bad save.

Mutation check: with `crap` dropped from the spread (complexity and coverage only), cases 1 and 2 failed at revision 10: `pick`'s CRAP went to pass at threshold 30 in case 1, and a CRAP state appeared in case 2. Restored at revision 11; both pass.

Why case 3 is not the brief's only case: the brief says a coverage-off good config. Coverage defaults to off since row 015-89, so a bad save with a coverage-off good config does not change coverage, and it cannot show a re-key. Cases 1 and 2 show the re-key; case 3 shows the complexity settings (the coordinator agreed to keep both, reply f7ce9d85).

## Decisions the brief did not settle

- `crap` is kept too (coordinator 8b2a8995, reply f7ce9d85, option b). Without it, a bad save would reset `crap.threshold` and `crap.enabled` to their defaults, and the coverage step would judge CRAP again twice. D1, the board and the brief are being amended by the coordinator.
- The test file runs node:test, so `test/version-sensitive.test.ts` requires an entry that selects it. The approved option was one line beside `test/daemon/reload-projects` (reply 34b229c8), not a rename.

## For the next worker

- `test/daemon/reload-projects.test.ts`, case "keeps the projects through a file that does not parse", still sets `coverage.enabled` to the default and its comment says a coverage toggle would re-key the node:test files. That reason no longer holds after this fix; the case still passes. A later change may drop the setting and the comment. It was left unchanged, as the brief says.
- The `lint` section (017) still takes its defaults at a bad save. The brief keeps it out of scope.
