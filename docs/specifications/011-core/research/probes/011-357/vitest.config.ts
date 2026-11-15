import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// A scratch HOME: nothing the probe starts reaches the real one.
const home = mkdtempSync(join(tmpdir(), "squeal-011-357-home-"));

export default defineConfig({
  test: {
    include: ["docs/specifications/011-core/research/probes/011-357/*.test.ts"],
    maxWorkers: 1,
    testTimeout: 300_000,
    env: { HOME: home, XDG_RUNTIME_DIR: home },
  },
});
