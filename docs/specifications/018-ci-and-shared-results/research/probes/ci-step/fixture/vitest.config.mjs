import { defineConfig } from "vitest/config";
import { preview } from "@vitest/browser-preview";
export default defineConfig({
  test: {
    projects: [
      { test: { name: "node", environment: "node", include: ["node/*.test.js"] } },
      { test: { name: "browser", include: ["web/*.test.js"], browser: { enabled: true, provider: preview(), instances: [{ browser: "chromium" }] } } },
    ],
  },
});
