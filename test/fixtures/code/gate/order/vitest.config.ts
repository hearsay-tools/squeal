import { defineConfig } from "vitest/config";

// One file at a time, so the order the gate gives is the order the files run in. The project's
// own testTimeout is far above the sleep: the budget, not Vitest, stops the hub's test.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], maxWorkers: 1, testTimeout: 900_000 },
});
