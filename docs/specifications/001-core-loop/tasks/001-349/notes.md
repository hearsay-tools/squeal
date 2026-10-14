# 001-349: `vitest.excludeProjects`

Worker notes, 2026-10-14. D11 as amended by the human the same day: a config key, an exclude list.

## How Vitest 5 selects projects (read in source code, vitest 5.0.3)

- `createVitest` takes `project: string[]`, the `--project` option. Entries starting with `!` exclude. `matchesProjectFilter` and `matchesEntryFilter` in `dist/chunks/index.*.js`.
- `resolveProjectEntries` first resolves every declared project's Vite config. Then it applies the filter to the entries (`applyProjectFilter`) before `attachProjectsFromEntries` creates any `TestProject`. An excluded project has no Vite server, no global setup run, no listed file. It is absent from `vitest.projects`, so it gets no environment, closure, key or count.
- A name matches as `wildcardPatternToRegExp` does: `*` is a wildcard and case is ignored. A `!name` entry also drops the projects nested under `name` (`ancestors`) and the browser instances of a browser project `name`.
- When the filter leaves no project, `createVitest` throws: "No projects were found ... The filter matched no projects". With every project excluded, the recovering runner notes the failure and every check of the worktree is unknown. The spec says nothing about this case. I left it as it is.

## What the code does

- `src/core/types/policy.ts`, `src/core/daemon/policy.ts`: `vitest: { excludeProjects: [] }` with the loader's `strings` leaf. A wrong type gives `"vitest.excludeProjects" must be an array of strings, got …` and the default `[]`. An unknown key under `vitest` is reported as usual.
- `src/runners/vitest/exclude.ts`:
  - `projectFilter` turns the list into Vitest's `project` option.
  - `unknownExclusions` resolves the config again, unfiltered, through the project's own `vitest/node` `resolveConfig`, which creates no project. It returns one problem per name that matches no project name or ancestor: `"vitest.excludeProjects[<index>]" names no Vitest project ("<name>"); it is left out`. The matching is Vitest's, so the check and the filter never disagree about a name.
  - The resolution runs beside `createVitest`, so it adds CPU but no latency. A config that fails to resolve reports nothing here; the instance's own failure says why.
- `src/runners/vitest/adapter.ts`:
  - At each start it reads the list (`excludeProjects`, a getter like `observe`), passes the filter and records what it started with.
  - Each unknown name becomes a note, `squeal.config.json: <problem>`, once per text per worktree root (`noteOnce`, as the optimizer note does).
  - `#invalidate` recreates the instance when the list moved since the instance started, as it does for a config file. `recreatedProjects` names the projects before and after, so the scheduler lists again and re-resolves. The policy is reloaded in the revision's transaction (`rekeyContent`), before the runner part calls `invalidate`, so the new list is read there. A revision that leaves the list as it was recreates nothing.
  - A run between the reload and that runner part uses the old instance. The slow tier's instance is made per pass and reads the list then.
  - The recreate is not triggered from `#instance` (as `observe.runtimeInputs` is), because a recreate there reports no projects to the scheduler and the listing would not follow.
- `src/core/daemon/daemon.ts`: `excludeProjects: () => this.#policy.vitest.excludeProjects`.
- Naming as not run:
  - Primer (`coverage.ts`, `primer.ts`): `Squeal covers Vitest (vitest.config.ts); its project "e2e" is not run, excluded by squeal.config.json.`
  - Status (`snapshot.ts`, `format-status.ts`): `Not run: Vitest project "e2e", excluded by squeal.config.json`, under the checkpoint and slow lines. `StatusSnapshot.vitestExcluded` is optional, absent when the list is empty.
  - Both apply the daemon's rule for building Vitest (spec 003 D7). Both name the policy's list as written, an unknown name included. The hooks cannot see which names the daemon found unknown, and naming an unknown name as not run is still true.
- Uncovered edits: `tellUncovered` counts a path as covered only when it is a listed test file or in a listed file's closure. An excluded project's files are never listed, so a file only they read is uncovered. No new code. The adapter test pins it: `affected(["src/browser-only.ts"])` is empty.
- `plugins/*/skills/squeal/references/policy.md`: a row for the key.

## Decisions the spec did not settle

1. **Names match as Vitest's `--project` matches.** Wildcards work, case is ignored, and a name drops its nested projects. The spec says "names of Vitest projects". An exact match would need the full name list before the instance starts, and could still disagree with Vitest's own match. 005-57 can copy the test script's `--project` flags verbatim.
2. **The unknown-name check resolves the config a second time.** Only when the list is non-empty, beside the start. The filtered instance never learns the excluded names, and no Vitest hook exposes them.
3. **Editing the key re-keys the remaining projects once.** Every project's config files and packages are inputs of each project's environment (D3), so the excluded project's config file leaves them. The filter itself never reaches the config tests receive (pinned in the test). After that, an edit to the excluded project's config no longer re-keys the others, which is the point.
4. **Every project excluded** is a runner failure (Vitest throws). Not special-cased.

## Key format

`src/core/daemon/policy.ts`, `src/core/types/policy.ts` and the adapter are guarded sources. `test/keys/key-format.test.ts` fails until the coordinator bumps `KEY_FORMAT_VERSION` and re-pins. I left the bump and the pin alone, as the brief says.

## Draft spec wording

D11, the `vitest.excludeProjects` bullet, after "names of Vitest projects Squeal never runs": "matched as Vitest's `--project` matches them (a `*` wildcard, case ignored, a name drops the projects nested under it); Squeal passes them to Vitest as `!name` filters, so an excluded project is never created. A revision that changes the list recreates the instance and lists again; the remaining projects re-key once, since the excluded project's config leaves their environment (D3). A name no project has is found by resolving the config unfiltered beside the instance; the note is the `slow.include` form. Excluding every project is a runner failure."

D4: "`createVitest` also takes `project`, the `!name` filters of `vitest.excludeProjects` (D11)."

## Contracts 005-57 reuses

Kept as given: the key path `vitest.excludeProjects`, and the message `"vitest.excludeProjects[<index>]" names no Vitest project ("<name>"); it is left out`, produced by `unknownExclusions` in `src/runners/vitest/exclude.ts`. The daemon's note prefixes it with `squeal.config.json: `. For `--check`, 005-57 can call `unknownExclusions(await loadVitest(root), root, names)` directly.
