# 001-424 brief: a stale "Failed to resolve import" after the missing file is added

Use /worker. Shape: research then repair.

**Outcome:** once a missing import target is added, the importer's next Squeal result matches what `npx vitest run` gives, with no touch.

**Report** (2026-10-15, from an agent using Squeal in another repository; harness and version unknown): "after I created new files, Squeal kept reporting a stale "Failed to resolve import ./markdown". Running the tests directly passed, and Squeal recovered only after I touched the files and waited."

**Read:** board row 001-424 (the coordinator's source reading); spec 001 D3 (closure, resolution candidates) and D4 (`invalidate`, the add rules and the `packageCache` paragraph); `reviews/wave-9b.md` S1.

**Steps:**
1. Reproduce in a fixture whose test runs in a client environment. Lead: a local custom environment with `viteEnvironment: "client"`, so no new dependency. A test imports `./markdown`; run it through the adapter or a daemon; add `markdown.ts`. Record the key, whether the file re-ran, and the result. Then repeat with both files written at once in a new directory. Write what went wrong, and where, in `tasks/001-424/notes.md`.
2. Fix where it goes wrong. If the cause is Vite state that only Vite's watcher clears, do what that watcher does on an add, in every environment, as `dropPackageData` in `stale.ts` does for manifests.
3. Edit D3 or D4 if a rule changes. Say in your final message whether closure contents changed, because that is key-relevant.

**Owns:** `src/runners/vitest/`, its tests, a new fixture under `test/fixtures/`, `tasks/001-424/notes.md`, and spec 001's D3 and D4 text. **Leave alone:** `docs/board.md`, `plugins/*/dist`, versions and key pins. Ask before editing `src/core/`.

**Done when:**
- A regression test fails on main and passes with the fix. In it, a client-environment importer fails to resolve `./markdown`; after the file is added, the next result passes with no touch.
- The same test passes with both files written at once in a new directory.
- `npm run lint`, `npm run typecheck` and `squeal run --all --wait` are green, with their output pasted.
