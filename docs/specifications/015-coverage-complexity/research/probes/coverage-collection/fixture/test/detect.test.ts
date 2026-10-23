// Fidelity probe: what a test can see of coverage.
import inspector from "node:inspector";
import { expect, test } from "vitest";
import { add } from "../src/math.js";

test("what a test can see", () => {
  const seen = {
    istanbulGlobal: typeof (globalThis as Record<string, unknown>).__VITEST_COVERAGE__ !== "undefined" ||
      typeof (globalThis as Record<string, unknown>).__coverage__ !== "undefined",
    addSource: add.toString().length,
    addSourceHasCounter: /cov_|__coverage__|\+\+/.test(add.toString()),
    nodeV8Coverage: process.env.NODE_V8_COVERAGE ?? null,
    inspectorUrl: inspector.url() ?? null,
  };
  console.log(`SEEN ${JSON.stringify(seen)}`);
  // An inspector session of the test's own: does starting/stopping precise coverage
  // here disturb the provider's?
  const session = new inspector.Session();
  session.connect();
  session.post("Profiler.enable");
  session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  session.post("Profiler.stopPreciseCoverage");
  session.post("Profiler.disable");
  session.disconnect();
  expect(add(2, 2)).toBe(4);
});
