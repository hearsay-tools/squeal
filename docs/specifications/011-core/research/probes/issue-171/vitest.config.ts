import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    root: new URL("../../../../../../", import.meta.url).pathname,
    include: ["docs/specifications/011-core/research/probes/issue-171/*.probe.ts"],
  },
});
