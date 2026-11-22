# Spec 024: Wave 0 brief

## Row 024-01: wave 0 checks (binary detection, installed `PLUGIN_DATA` path, `hooks/run` large stdin, fixture schemas)

- **Outcome**: Answer spec 024 Open questions 2, 3 and 4 and document exact hook payload schemas in `docs/specifications/024-antigravity-adapter/research/wave-0-checks.md`.
- **Read**: `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/024-antigravity-adapter/spec.md` (D1, D3, D4, D6, Open questions 2–4), `status.md`, `research/antigravity-hooks-and-plugins.md`, and `research/README.md`.
- **Shape**: research.
- **Starting seam**: `docs/specifications/024-antigravity-adapter/research/README.md` (all four numbered questions). Put throwaway probes under `docs/specifications/024-antigravity-adapter/research/probes/wave-0-checks/`.
- **Ownership**: `docs/specifications/024-antigravity-adapter/research/wave-0-checks.md` and `docs/specifications/024-antigravity-adapter/research/probes/wave-0-checks/**`. Edit no product code, no `spec.md`, no `status.md`, no `docs/board.md`.
- **Privacy**: Never commit absolute home paths (write `~`), private repository names, credentials, or recorded session logs. Verify with `pnpm run check:private` before committing.
- **Done when**: Every question in `research/README.md` has a tagged verdict (`verified by experiment`, `read in official docs`, `read in source code`, or `not determined, because`), committed with its probes, and `pnpm run check:private` passes.
- **Role**: Use `/researcher`.
