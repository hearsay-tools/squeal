import { defineConfig } from 'vitest/config'

// Mirrors cezarion's packages/web/e2e/vitest.config.ts: one project, a globalSetup that
// boots a detached server and a teardown that only releases its own claim.
export default defineConfig({
  test: {
    include: ['e2e/*.e2e.mjs'],
    globalSetup: ['./global-setup.mjs'],
    fileParallelism: false,
  },
})
