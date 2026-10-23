# 011-36: a cached ignored path nothing names stops being watched

Use /worker. Shape: slice. Dispatched by coordinator e67bc707 on 2026-10-23, the human's go ("Address 011-36"), beside coordinator 04a258b0's waves 22 and 23.

Outcome: after one daemon start, a gitignored path in the stat cache that no closure, environment, lockfile, declaration or observed read names is no longer hashed or watched.

Read board row 011-36; 013 `tasks/013-01/design.md` section 4; spec 011 C2 (the paragraph on ignore rules: "Gitignored files that appear in a known closure ... are added to the stat cache and watched individually").

Seam: `Keys.bootstrap` in `src/core/scheduler/keying.ts` (`:172-175`) puts every cached ignored path a declaration does not select into `#extra` for good. `#release` (`:448-464`) judges only `#revived`, and runs only from `trackUntracked`. A lead: give bootstrap's ignored extras to the same judgement, once the runners' closures replace the saved ones. In cezar the declaring project was removed too: check that a removed project's saved closures do not keep the paths named.

Owns `keying.ts`, `test/scheduler/scratch-inputs.test.ts`, new tests under `test/scheduler/`, `tasks/011-36/`. Not yours: `scheduler.ts` (011-128), `src/harness/`, `src/core/delivery/`, `src/cli/`, `src/core/status/`, `src/core/store/`, the board, spec text, bundles, version. No `npm run build`.

Done when a regression over a seeded stat cache shows the drop with no revision, and a path a closure or observed read names stays watched; a C2 sentence is drafted in `tasks/011-36/notes.md`; lint, typecheck and `squeal run --all --wait` pass. Run `test/scheduler/scratch-inputs.test.ts` directly. Paste the output in your summary.
