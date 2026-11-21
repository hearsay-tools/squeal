import { defineConfig } from "vitest/config";
import { TEST_VERSION } from "./test/fixed-version.js";

export default defineConfig({
  // Row 011-425: workers report a fixed version and read no `package.json` for it.
  define: { __SQUEAL_VERSION__: JSON.stringify(TEST_VERSION) },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/fixtures/**", "node_modules/**"],
    // Fails the run when a daemon a test started outlives it (lessons, defect 29).
    globalSetup: ["test/global-teardown.ts"],
  },
});
