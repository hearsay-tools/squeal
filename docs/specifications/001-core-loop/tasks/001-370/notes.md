# 001-370: repair of review 001-369 (`reviews/wave-13bl.md`) on 001-349

Worker notes, 2026-10-14. B1, S1, S2, N1, and the coordinator's break: the adapter's `project` option replaced a config's own `test.project` filter.

## What Vitest 5.0.3 does (verified by experiment, read in source code)

Probe: the reviewer's config, three inline projects `a`, `b`, `c` over one file, with `test.project` unset, `["a"]` and `["!c"]`. `resolveConfig` from `vitest/node`, then `createVitest`:

| configured `test.project` | `resolveConfig({root})` | `resolveConfig({root, project: []})` | `createVitest({project: ["!b"]})` | `createVitest({project: [...configured, "!b"]})` |
| --- | --- | --- | --- | --- |
| unset | filter `[]`, names a b c | a b c | a c | a c |
| `["a"]` | filter `["a"]`, names a | a b c | **a c** | a |
| `["!c"]` | filter `["!c"]`, names a b | a b c | **a c** | a |

- The CLI `project` option replaces the configured one (`TestConfigPlugin` deep-merges the options over `config.test`, an array replaced whole; `resolved.project = toArray(resolved.project)` at `index.DpLw24bj.js:14385`). The bold cells are the break: the key widened what runs.
- `project: []` clears the configured filter: `applyProjectFilter` (`:13117`) returns every entry for an empty filter, so `resolvedProjects` is the whole universe.
- `resolveConfig`'s `test.project` is the configured filter, already an array.
- The combined filter is Vitest's own semantics (`matchesEntryFilter`, `:13160`): any `!` entry drops, then the positives are ORed. So configured filter plus `!name` runs exactly what Vitest would run, minus the excluded names.

## What the code does

- `src/runners/vitest/exclude.ts`:
  - `exclusion(node, root, names)` replaces `projectFilter`. With an empty list: no option, no resolution, as before. Otherwise it resolves the config once, before `createVitest`, to read the configured filter, and returns `project: [...configured, ...names.map((n) => "!" + n)]`.
  - With no configured filter, that resolution already saw every project, so the unknown-name check reuses it: one extra resolution per start, as before, now sequential. With a configured filter, the check resolves again beside `createVitest` with `project: []`: two extra resolutions.
  - `unknownExclusions(node, root, names)` keeps its signature and message for 005-57, and now passes `project: []`.
  - A config that fails to resolve in the sequential read fails the start there, with the error `createVitest` would have thrown. The unknown check still swallows its own failure.
- `src/runners/vitest/adapter.ts`: `#start` awaits `exclusion` before `createVitest`.
- `src/core/text.ts` `excludedProjectsText`, used by `format-status.ts` and `primer.ts`: a plain name stays `project "e2e"`; an entry with a `*` reads `projects matching "E*"`; both together, `project "e2e" and projects matching "E*"`. The verb is plural unless the list is one plain name. The hooks read only the policy, so they cannot know an ancestor name (`Parent`) covers nested projects; it prints as `project "Parent"`, which names a declared project container and stays true.

## Cost of the sequential resolution

Measured on the five-projects fixture, host load 37 to 60: `resolveConfig` 22 to 55 ms, `createVitest` 18 to 32 ms. It evaluates every declared config, so a repository with heavy config plugins pays about one config evaluation more per start or recreation, and only when the list is non-empty. A start with a configured filter also runs the unknown-name resolution beside the instance, which the start awaits (N1).

## Tests

- `test/runners/vitest/exclude-projects-filter.test.ts`:
  - Run: configured `["a"]`, `["!c"]`, `["a","b"]` with `b` excluded run `a`; configured `["!c"]` with `a` excluded runs `b`. Red before (`a c`, `a c`, `a c`, `b c`).
  - Baselines without the key: `["a"]` runs `a`, `["!c"]` runs `a b`.
  - Unknown names: configured `["!c"]` with `["c", "C*", "nope"]` excluded reports only `nope`. Red before (it reported `c` and `C*` too).
  - S1 digest: the `server` environment's hash, through `environmentHash` with fixed core inputs, changes when the file-based `e2e` is excluded and stays the same when the inline `web` is. Green before; it pins the corrected wording.
- `test/status/excluded-projects.test.ts`, `test/harness/primer-excluded.test.ts`: the selector wording for patterns, under both harnesses.

## Decisions the review left open

1. **S2: selector labels, not resolved leaf names.** Status and the primer read the policy, not the daemon's listing, so they print entries as written, with patterns as selectors. Carrying the matched leaf names would need a new snapshot field the daemon writes after each listing.
2. **A configured filter's read failure fails the start before `createVitest`.** The same config error `createVitest` would throw; not falling back to `!name` alone, which would widen what runs.

## Key format

`exclude.ts` and the adapter are guarded sources. `test/keys/key-format.test.ts` fails its three pin tests: the guarded hash moves from `535feb18...` to `97b81e808185e7dda9fc2b18ed51cd12a548786deb4c17c3f5119c9adeff6517`. Format 9 is not released yet (review wave-13bl, What fits), so the coordinator re-pins format 9. I left the version and the pin alone.

## D11 wording changed (spec.md, the `vitest.excludeProjects` bullet)

- "`squeal status` and the start's delivery name each entry as not run, excluded by `squeal.config.json`, a plain name as the project (`project "e2e"`) and a pattern as a selector (`projects matching "E*"`), ..."
- "... since the list joins that filter as `!name` entries. Vitest's `project` option replaces a config's own `test.project` filter, so Squeal passes that filter with them, read by resolving the config once before the instance: the key only narrows what Vitest would run. A name matching no project, the config resolved with its own filter cleared so a project that filter drops still counts, is reported as ..."
- "Changing the list recreates the Vitest instance; a remaining project re-keys only when its environment's inputs change (D3). Every project's config files are in each project's environment, so excluding a project with its own config file re-keys the others once, and excluding an inline project re-keys none of them."

## Status line draft

- 2026-10-14, 001-370 (repair of review 001-369 on 001-349; `tasks/001-370/notes.md`): D11 amended. `vitest.excludeProjects` joins a config's own `test.project` filter instead of replacing it, so it only narrows what Vitest runs; the unknown-name check resolves the config with that filter cleared. Survivors re-key only when their environment's inputs change. Status and the start's delivery word a pattern entry as a selector.
