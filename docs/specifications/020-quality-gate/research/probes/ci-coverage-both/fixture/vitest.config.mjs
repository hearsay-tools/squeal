// The project's own coverage: V8, json + json-summary reporters, include
// src/**, and a lines threshold that src/untested.ts makes fail (exit 1).
// THRESHOLD=0 turns the threshold off.
import { defineConfig } from "vitest/config";
const lines = Number(process.env.THRESHOLD ?? 95);
export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["json", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**"],
      ...(lines > 0 ? { thresholds: { lines } } : {}),
    },
    projects: [
      { test: { name: "iso", include: ["test/iso/**/*.test.ts"] } },
      { test: { name: "shared", include: ["test/shared/**/*.test.ts"], isolate: false, maxWorkers: 1, sequence: { groupOrder: 1 } } },
    ],
  },
});
