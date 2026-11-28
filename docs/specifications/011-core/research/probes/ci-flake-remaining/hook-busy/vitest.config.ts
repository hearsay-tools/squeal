// Throwaway probe config, row 011-439. Runs only hook-busy.probe.ts, from the repository root:
//   timeout 600 pnpm exec vitest run --config docs/specifications/011-core/research/probes/ci-flake-remaining/hook-busy/vitest.config.ts
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(import.meta.dirname, "../../../../../../.."),
  test: { include: ["docs/specifications/011-core/research/probes/ci-flake-remaining/hook-busy/*.probe.ts"] },
});
