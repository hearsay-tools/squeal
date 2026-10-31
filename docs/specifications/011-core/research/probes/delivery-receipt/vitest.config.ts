import { defineConfig } from 'vitest/config';
export default defineConfig({test: {
  include: ['docs/specifications/011-core/research/probes/delivery-receipt/*.probe.ts'],
  globalSetup: ['test/global-teardown.ts'], maxWorkers: 1, fileParallelism: false,
  testTimeout: 15000,
}});
