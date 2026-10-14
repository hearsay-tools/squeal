import { defineConfig } from "vitest/config";

// Task 001-362's probes, outside the suite: `npx vitest run --config <this file>`.
export default defineConfig({
  test: {
    include: ["docs/specifications/001-core-loop/tasks/001-362/*.probe.ts"],
    globalSetup: ["test/global-teardown.ts"],
  },
});
