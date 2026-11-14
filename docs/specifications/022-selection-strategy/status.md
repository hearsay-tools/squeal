# 022 Selection strategy: status

Stage: research (2026-11-14)
Started: 2026-11-14

## Decisions so far

- 2026-11-14, the human: "Research adding an option to configure test selection strategy. We currently use static imports, but I would like to add selecting by a module the test loads."
- 2026-11-14, the coordinator (3d192245): a new spec, not an amendment of 011 (keys, closures), 013 (the Vitest closure) or 015 (coverage). Reading of the request: today a test file re-runs when any file in its import closure changes (static and dynamic imports from the transform, literal `require`, glob expansions, observed reads, declared inputs, and its project's setup and config closure). The new strategy re-runs it only when a module it actually loaded in its last run changes. This is module level. It is not the line or function level selection that 015 researched and deferred (`../015-coverage-complexity/research/line-level-selection.md`, `selection-tools.md`, `cezar-selection.md`). Evidence that it can pay: `../015-coverage-complexity/research/edit-reach.md` 3: on this repository 33% of re-run seconds go to test files that do not load the edited file in their own process. Wave 0 is two researchers in parallel on the standing researcher model, topics `loaded-modules` (row 022-01) and `selection-option` (row 022-02), brief `research/README.md`.

## Open questions

1. Is "a module the test loads" the module set of the test file's own process, as read here? Or a per-test set, or a user-named module (`run the tests that load X`)? The brief asks the researchers to name the alternatives they meet; the human confirms with the wave 0 results.
2. Which runners: Vitest only first, or Vitest, node:test and pytest together?

## Amendment log
