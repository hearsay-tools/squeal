// Row 005-124: runs only the timing probe (`measure.probe.ts`), from the repository root.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: new URL("../../../../..", import.meta.url).pathname,
    include: ["docs/specifications/005-agent-adoption/tasks/005-124/measure.probe.ts"],
    pool: "forks",
    maxWorkers: 1,
  },
});
