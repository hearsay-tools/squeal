import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Throwaway probe for gh-92: runs only this folder's probe, from the repo root.
export default defineConfig({
  root: fileURLToPath(new URL("../../../../../..", import.meta.url)),
  test: {
    include: ["docs/specifications/011-core/research/probes/issue-92/*.probe.test.ts"],
    globalSetup: ["test/global-teardown.ts"],
  },
});
