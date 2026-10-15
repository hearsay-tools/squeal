import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "./client-env.ts",
    setupFiles: ["test/setup.ts"],
    testTimeout: 60_000,
  },
});
