import { defineConfig } from "vitest/config";

// Spec 020 D14 (row 020-15a): cezar's shape in #172. The browser specs load
// the server code through a helper, and their project's global setup is the
// expensive part a server-only gate must not start.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "server", include: ["test/**/*.test.ts"] } },
      {
        test: {
          name: "browser",
          include: ["e2e/**/*.test.ts"],
          globalSetup: ["e2e/setup.ts"],
        },
      },
    ],
  },
});
