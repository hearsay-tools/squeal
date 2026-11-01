import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["duplicate.test.ts"],
    maxWorkers: 1,
  },
});
