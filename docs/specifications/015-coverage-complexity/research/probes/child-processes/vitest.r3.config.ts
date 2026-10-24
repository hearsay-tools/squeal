// Throwaway probe config (015 R3): the repository's vitest.config.ts plus
// in-process v8 coverage of src/ and the child-coverage setup file.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/fixtures/**", "node_modules/**"],
    globalSetup: ["test/global-teardown.ts"],
    setupFiles: ["./r3/child-env.setup.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      reporter: [["json", { file: "coverage-final.json" }]],
      reportsDirectory: process.env.R3_INPROC ?? "/tmp/sq015-r3/inproc",
    },
  },
});
