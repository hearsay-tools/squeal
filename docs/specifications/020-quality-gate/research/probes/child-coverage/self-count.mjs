// Throwaway probe for research/child-coverage.md (Q5). Not product code.
// Run with and without NODE_V8_COVERAGE: a process started with it counts
// calls made before its own Profiler.startPreciseCoverage.
import { Session } from "node:inspector/promises";
export function clamp(x) { return x < 0 ? 0 : x; }
clamp(1);
const s = new Session(); s.connect();
await s.post("Profiler.enable");
await s.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
clamp(5);
const { result } = await s.post("Profiler.takePreciseCoverage");
const fn = result.find((r) => r.url.endsWith("/self-count.mjs")).functions.find((f) => f.functionName === "clamp");
console.log(JSON.stringify({ env: process.env.NODE_V8_COVERAGE ?? null, count: fn.ranges[0].count }));
