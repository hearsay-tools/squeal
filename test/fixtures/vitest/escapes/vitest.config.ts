import plugin from "plugin-pkg";
import { defineConfig } from "vitest/config";

// Task 001-117 (review wave-11d S1 to S3): the node_modules this fixture loads
// are written by the test (`test/runners/vitest/escapes.test.ts`). The plugin
// declares `spawner`, which `outer.test.ts` also reaches.
export default defineConfig({
  plugins: [plugin()],
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
