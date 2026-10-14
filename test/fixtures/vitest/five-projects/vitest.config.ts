import { defineConfig } from "vitest/config";

// Task 001-349: cezar's shape. Its `npm test` runs four projects; the fifth,
// `e2e`, has its own config and needs what only `npm run test:e2e` boots.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "server", include: ["test/server.test.ts"] } },
      { test: { name: "contract", include: ["test/contract.test.ts"] } },
      { test: { name: "api-client", include: ["test/api-client.test.ts"] } },
      { test: { name: "web", include: ["test/web.test.ts"] } },
      "e2e/vitest.config.ts",
    ],
  },
});
