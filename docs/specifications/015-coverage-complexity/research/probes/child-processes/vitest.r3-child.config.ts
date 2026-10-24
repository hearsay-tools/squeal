// Throwaway probe config (015 R3 timing): the repository's vitest.config.ts
// plus the child-coverage setup file only; no in-process coverage.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/fixtures/**", "node_modules/**"],
    globalSetup: ["test/global-teardown.ts"],
    setupFiles: ["./r3/child-env.setup.ts"],
  },
});
