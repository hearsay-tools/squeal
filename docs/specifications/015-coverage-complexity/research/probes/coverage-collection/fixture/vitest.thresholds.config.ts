import { defineConfig } from "vitest/config";
// A project that already has coverage on, with thresholds and include.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: { lines: 99, functions: 99 },
    },
  },
});
