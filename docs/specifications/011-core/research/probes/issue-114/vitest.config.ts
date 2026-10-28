import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["docs/specifications/011-core/research/probes/issue-114/probe.test.ts"],
  maxWorkers: 1, testTimeout: 15000,
} });
