import plugin from "plugin-pkg";
import { defineConfig } from "vitest/config";

// Task 001-105: the node_modules this fixture imports are written by the test
// (`test/runners/vitest/packages.test.ts`), so each bump is a lockfile edit.
// Task 001-109: `environment` and `snapshotSerializers` name packages by string.
export default defineConfig({
  plugins: [plugin()],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    environment: "custom",
    snapshotSerializers: ["ser-pkg"],
    server: { deps: { inline: ["inl"] } },
    testTimeout: 60_000,
  },
});
