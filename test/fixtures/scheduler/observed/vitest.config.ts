import { defineConfig } from "vitest/config";

// One project per pool, so every test file runs under forks and threads (task 001-132).
export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      { test: { name: "forks", pool: "forks", include: ["test/**/*.test.ts"] } },
      { test: { name: "threads", pool: "threads", include: ["test/**/*.test.ts"] } },
    ],
  },
});
