import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/* Row 021-31's allocation probe only; never part of the suite. */
export default defineConfig({
  root: fileURLToPath(new URL("../../../../../", import.meta.url)),
  test: {
    include: ["docs/specifications/021-remote-store-and-execution/tasks/021-31/*.probe.ts"],
    globalSetup: [],
    fileParallelism: false,
  },
});
