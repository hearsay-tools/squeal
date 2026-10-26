import { defineConfig } from 'vitest/config'

// Two projects shaped like cezarion's: fast unit tests, and browser-like specs whose
// globalSetup runs a shell script that writes ignored runtime state and a build mirror.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/*.test.mjs'] } },
      {
        test: {
          name: 'e2e',
          include: ['e2e/*.e2e.mjs'],
          globalSetup: ['./e2e/setup.mjs'],
          fileParallelism: false,
        },
      },
    ],
  },
})
