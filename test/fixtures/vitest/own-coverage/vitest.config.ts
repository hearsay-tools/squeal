import { defineConfig } from "vitest/config";

// Row 013-07: the project's own coverage, with a threshold that fails.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "custom",
      customProviderModule: "./coverage-provider.ts",
      include: ["src/**"],
      thresholds: { lines: 99 },
    },
  },
});
