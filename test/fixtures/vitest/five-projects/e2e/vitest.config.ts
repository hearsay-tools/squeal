import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "e2e", include: ["*.e2e.test.ts"], globalSetup: ["./boot.ts"] },
});
