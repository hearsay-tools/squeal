import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["test/*.unit.test.ts", "test/both.test.ts"] } },
      {
        test: {
          name: "setup",
          include: ["test/both.test.ts"],
          setupFiles: ["test/setup.ts"],
        },
      },
    ],
  },
});
