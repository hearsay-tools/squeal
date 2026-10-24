// Throwaway probe config (015 R3): the repository's vitest.config.ts plus
// in-process v8 coverage of src/ only (run 2: no child-coverage setup file,
// a report even when a test fails).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/fixtures/**", "node_modules/**"],
    globalSetup: ["test/global-teardown.ts"],
    coverage: {
      enabled: true,
      reportOnFailure: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      reporter: [["json", { file: "coverage-final.json" }]],
      reportsDirectory: process.env.R3_INPROC ?? "/tmp/sq015-r3/inproc",
    },
  },
});
