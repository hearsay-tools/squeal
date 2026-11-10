// Throwaway probe config for research/child-coverage.md (Q5). Not product code.
// The repository's config, plus visible.setup.ts.
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../../../../../../vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({ test: { setupFiles: [new URL("./visible.setup.ts", import.meta.url).pathname] } }),
);
