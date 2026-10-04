import { defineConfig } from "vitest/config";
import { include } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    include,
    setupFiles: ["test/setup.ts"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 60_000,
  },
});
