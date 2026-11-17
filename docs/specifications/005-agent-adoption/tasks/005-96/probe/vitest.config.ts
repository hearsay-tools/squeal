import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// A scratch HOME: nothing the probe starts reaches the real one.
const home = mkdtempSync(join(tmpdir(), "squeal-005-96-home-"));

export default defineConfig({
  test: {
    include: ["docs/specifications/005-agent-adoption/tasks/005-96/probe/*.test.ts"],
    maxWorkers: 1,
    testTimeout: 300_000,
    env: { HOME: home, XDG_RUNTIME_DIR: home },
  },
});
