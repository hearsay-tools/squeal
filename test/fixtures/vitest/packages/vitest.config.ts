import plugin from "plugin-pkg";
import { defineConfig } from "vitest/config";

// Task 001-105: the node_modules this fixture imports are written by the test
// (`test/runners/vitest/packages.test.ts`), so each bump is a lockfile edit.
export default defineConfig({
  plugins: [plugin()],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    server: { deps: { inline: ["inl"] } },
    testTimeout: 60_000,
  },
});
