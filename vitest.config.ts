import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/fixtures/**", "node_modules/**"],
    // Fails the run when a daemon a test started outlives it (lessons, defect 29).
    globalSetup: ["test/global-teardown.ts"],
  },
});
