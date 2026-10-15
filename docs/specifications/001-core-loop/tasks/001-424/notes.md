# 001-424 notes: a stale "Failed to resolve import" after the missing file is added

Worker notes, 2026-10-15. Vitest 5.0.3 on Node 24.21.0, Linux.

## What went wrong, and where

A **setup file**'s import of a missing file. A `setupFiles` entry (or a module it imports)
imports `../src/markdown`, which does not exist. Every test file of the project fails:
`Failed to resolve import "../src/markdown" from "test/setup.ts". Does the file exist?` in a
client environment, `Cannot find module '../src/markdown' imported from test/setup.ts
(ERR_MODULE_NOT_FOUND)` in `node`. When `src/markdown.ts` is added, under a real daemon:

- **Key:** unchanged. The setup closure is in no test file's closure. It enters only the
  environment hash, through `RunnerEnvironment.files`, and `projectEnvironment`
  (`src/runners/vitest/environment.ts`) listed only the closure's existing files
  (`setup.files`), never its missing targets. The add was therefore no environment input
  (`KeyIndex.isEnvironmentInput`), and no key moved.
- **Re-run:** none. The failure stayed `current` at the new revision, for more than 40 s
  in a probe (which covers the 30 s reconciliation pass). Touching the setup file re-keys the
  project's environment provisionally, so the project re-runs: this matches the report's
  "recovered only after I touched the files".
- **Result:** the stale `fail`, while `npx vitest run` passes.

Two more checks used the exact missing path, never its candidates, so an extensionless
specifier (`../src/markdown`) never matched the added `src/markdown.ts`:
`isProjectInput` (`affected` on a setup closure's missing target) and `recreateTriggers`
(a `globalSetup` closure's missing target).

This does not depend on the client environment; only the error text does. The reporter's text
says the project ran in a client environment (jsdom, happy-dom or browser mode). It does not
say whether the failing import came from a setup file. That is the one shape found that stays
stale. Every test-file importer shape tried recovers on main (below).

## The fix

`ProjectInputs.missing` (`src/runners/vitest/project.ts`) holds every resolution candidate
(`missingCandidates`, `graph.ts`: the shared helper `closure()` now uses as well) of both setup
closures' missing targets. `projectEnvironment` lists the candidates in the environment's `files`,
and the core hashes a missing one as absent. `isProjectInput` and `recreateTriggers` match on them.
Spec 001 D3 (environment hash) and D4 (`affected`) say so.

**Closure contents:** a test file's closure is unchanged. The **environment's file list**
changes, and it is key-relevant, but only for a project whose setup or `globalSetup` closure
has an unresolved import. Every other project's environment hash is as before. For the one
that has one, the first start after the change re-keys it once. No `VITEST_ADAPTER_VERSION`
bump is needed: the new hash differs from the old one for exactly those projects.

## Cases ruled out (each recovers on main with no touch)

The lead from the brief and the board row is Vite's `moduleGraph._hasResolveFailedErrorModules`.
In Vite 8.3.2's import analysis, an unresolved import outside `ssr` adds the importer to that
set and throws. Only Vite's watcher reads the set, and only to send the importer through HMR on
a `create`. A failed transform leaves no `transformResult`, so the next fetch transforms the
module again, with or without a watcher. `staleTransforms` and the closure (`ssr`, where the
specifier stays verbatim and its candidates enter the closure) cover the rest.

Adapter level (`createVitestAdapter`: run, add, `invalidate`, run). Importer `src/uses-md.ts`
imports `./markdown`, and the test file imports `src/uses-md.ts`:

| Environment | Vite | Shapes | Result |
|---|---|---|---|
| local custom env, `viteEnvironment: "client"` | 8.3.2, 7.3.7, 6.4.4 | target alone; importer and target at once in a new directory | pass after the add |
| same | 8.3.2 | importer edited to add the import (after a passing run); two failing runs before the add; `isolate: false` | pass |
| jsdom, happy-dom | 8.3.2 | both shapes, each with and without `@vitejs/plugin-react` | pass |

Daemon level (`test/integration`-style real daemon, Vite 8.3.2, custom client env): the test
file importer, both shapes, recovers within seconds. The setup-file importer stays stale, in
both shapes and in both the client and `node` environments.

Not probed: browser mode (needs a browser provider; its Vite server is separate from
`project.vite`), a `projects` config with one client project beside an `ssr` one, and release
tags before main (0.1.168 onward). The parent asked for the setup-file lead and
those last two. The setup-file lead reproduced on main and needs no release bisect.

On main the daemon-level regression is not deterministic. In one run "the target alone" stayed
stale and the new-directory case recovered. In the next run it was the other way round. The
recovery path was not identified; it is probably timing against a run's own check of the
bytes it loaded (task 001-146). With the fix, both cases passed in three runs out of three.
The adapter-level test is the deterministic one: on main its environment lacks the
candidate.

## Tests

- `test/runners/vitest/client-environment.test.ts` (fixture `test/fixtures/vitest/client-env`):
  the test-file importer, both shapes, as regressions of what already works. The setup-file
  importer, both shapes: the environment lists the candidate, `affected` reports the project's
  test files, and the next run passes. The setup cases fail on main.
- `test/integration/setup-missing-import.test.ts`: the same setup-file scenario under a real
  daemon, both shapes; the next result after the add passes with no touch.
