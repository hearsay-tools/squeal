import { defineConfig } from "vitest/config";

/*
 * Row 005-17: the end-to-end suite with the real `claude` and `codex`
 * (`test/real-cli/`), run only by `npm run test:real-cli`. Its files end in
 * `.real.ts`, so `vitest.config.ts`'s include never picks them up: neither CI
 * nor the Squeal daemon runs them. One file at a time: each drives a scratch
 * machine whose harness calls and daemons take real time.
 */
export default defineConfig({
  test: {
    include: ["test/real-cli/**/*.real.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
