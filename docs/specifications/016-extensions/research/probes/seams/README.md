# Probe: seams (THROWAWAY)

Throwaway probe for `016-extensions/research/seams.md` (brief 016-01). Not product code; nothing imports it. `docs/` is outside lint, typecheck and the Vitest include.

- `scan.mjs <repo root>`: reads `src/` only, writes nothing. Prints the import edges from `src/core` and `src/cli` into `src/runners` and `src/harness` (static and dynamic), from `src/harness` into `src/runners` and `src/cli`, between runner folders, and the code lines (comments dropped) in `src/core`, `src/cli` and `src/harness/shared` that name a runner or a harness. A name counts by regex, so the counts are an upper bound on intent: `nodeTest` in a type name counts as a line.
- `scan-output.txt`: its output at `0822a4440` (2026-10-24).
- `minimal-adapter.ts`: the smallest object the `RunnerAdapter` type accepts, only the required members. Checked with `npx tsc --ignoreConfig --noEmit --strict --module nodenext --moduleResolution nodenext --target es2023 --skipLibCheck --types node minimal-adapter.ts` (tsc 7.0.2): exit 0. It shows the type only; the daemon has no way to load it.

Re-run: `node docs/specifications/016-extensions/research/probes/seams/scan.mjs .` from the repository root.
