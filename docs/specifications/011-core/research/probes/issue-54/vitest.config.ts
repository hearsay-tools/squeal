import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Throwaway (issue 54): runs only probe.test.ts, rooted at the repository so its imports resolve.
const root = fileURLToPath(new URL("../../../../../..", import.meta.url));

export default defineConfig({
  root,
  test: { include: ["docs/specifications/011-core/research/probes/issue-54/probe.test.ts"] },
});
