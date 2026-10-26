import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["probe.spec-102.js"],
    coverage: {
      enabled: true,
      provider: "custom",
      customProviderModule: process.env.PROVIDER,
      reporter: [],
      reportsDirectory: process.env.REPORTS,
    },
  },
});
