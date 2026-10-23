// Fidelity probe: a test that measures V8 coverage itself, as this repository's
// test/keys/validity/coverage.ts does for child processes, but in-process.
import inspector from "node:inspector/promises";
import { expect, test } from "vitest";
import { clamp } from "../src/math.js";

test("own precise coverage counts only what ran after it started", async () => {
  clamp(1, 0, 10); // before the test's own session starts
  const session = new inspector.Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  clamp(5, 0, 10);
  const { result } = await session.post("Profiler.takePreciseCoverage");
  await session.post("Profiler.stopPreciseCoverage");
  session.disconnect();
  const script = result.find((s) => s.url.endsWith("/src/math.ts"));
  const fn = script?.functions.find((f) => f.functionName === "clamp");
  console.log(`SEEN ${JSON.stringify({ clampCount: fn?.ranges[0].count ?? null })}`);
  expect(fn?.ranges[0].count).toBe(1);
});
