import { defineConfig } from "vitest/config";

// Spec 022 (row 022-03): a setup file every test file loads, a file that loads a module by a
// computed name, and one whose loaded modules are all in its closure.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], testTimeout: 60_000 },
});
