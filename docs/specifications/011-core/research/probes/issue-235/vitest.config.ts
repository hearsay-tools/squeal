import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['docs/specifications/011-core/research/probes/issue-235/scheduler.probe.ts'],
  maxWorkers: 1, testTimeout: 30000,
} });
