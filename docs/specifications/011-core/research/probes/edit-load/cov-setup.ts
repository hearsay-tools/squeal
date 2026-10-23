// 011-143 probe: per-test-file V8 block coverage. Throwaway.
import { Session } from "node:inspector/promises";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { afterAll, expect } from "vitest";

const OUT = process.env.EL143_COV_OUT ?? "/tmp/el143/cov/out";
const ROOT = process.env.EL143_ROOT ?? process.cwd();
const session = new Session();
session.connect();
const scripts = new Map<string, string>();
session.on("Debugger.scriptParsed", (m) => {
  const { scriptId, url } = m.params;
  if (url.includes(ROOT) && !url.includes("/node_modules/")) scripts.set(scriptId, url);
});
await session.post("Debugger.enable");
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
await session.post("Profiler.takePreciseCoverage"); // reset counters for this test file

afterAll(async () => {
  const testPath = (expect.getState().testPath ?? "unknown").replace(ROOT + "/", "");
  const { result } = await session.post("Profiler.takePreciseCoverage");
  mkdirSync(`${OUT}/src`, { recursive: true });
  const files: Record<string, { src: string; functions: unknown }> = {};
  for (const s of result) {
    const url = scripts.get(s.scriptId);
    if (!url) continue;
    if (!s.functions.some((f) => f.ranges.some((r) => r.count > 0))) continue;
    const { scriptSource } = await session.post("Debugger.getScriptSource", { scriptId: s.scriptId });
    const h = createHash("sha1").update(scriptSource).digest("hex");
    const p = `${OUT}/src/${h}.js`;
    if (!existsSync(p)) writeFileSync(p, scriptSource);
    files[url] = { src: h, functions: s.functions.map((f) => f.ranges) };
  }
  const name = createHash("sha1").update(testPath).digest("hex").slice(0, 16);
  writeFileSync(`${OUT}/${name}-${process.pid}.json`, JSON.stringify({ testPath, files }));
});
