import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "main", include: ["main/*.test.ts"] } },
      { test: { name: "gs", include: ["gs/*.test.ts"], globalSetup: ["gs/global-setup.ts"] } },
    ],
  },
});
