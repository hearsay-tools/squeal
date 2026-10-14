// Probe P1 (research/host-capacity.md): can a warm Vitest instance be resized
// between runs? Usage: node probe.mjs <scratch-dir> <forks|threads> [isolate]
// Writes a 40-file fixture into <scratch-dir> (which must resolve `vitest`
// from a `node_modules` beside it), then runs every file three times on one
// instance with maxWorkers 8, 2 and 8, set between runs on the resolved
// configs, and prints the peak of overlapping files and the distinct workers.
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createVitest } from "vitest/node";

const [dir, pool = "forks", isolate = "true"] = process.argv.slice(2);
const log = join(dir, "log.jsonl");
mkdirSync(join(dir, "test"), { recursive: true });
for (let i = 0; i < 40; i++) {
  writeFileSync(
    join(dir, "test", `f${i}.test.mjs`),
    `import { test } from "vitest";
import { appendFileSync } from "node:fs";
test("t", async () => {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 250));
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ pid: process.pid, pool: process.env.VITEST_POOL_ID, start, end: Date.now() }) + "\\n");
});
`,
  );
}
writeFileSync(
  join(dir, "vitest.config.mjs"),
  `export default { test: { pool: ${JSON.stringify(pool)}, isolate: ${isolate} } };\n`,
);

const vitest = await createVitest("test", { root: dir, watch: false, reporters: [] });
await vitest.standalone();
const specs = await vitest.globTestSpecifications();

function setWidth(n) {
  vitest.config.maxWorkers = n;
  for (const project of vitest.projects) project.config.maxWorkers = n;
}

function peak(rows) {
  const events = rows.flatMap((r) => [[r.start, 1], [r.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let max = 0;
  for (const [, d] of events) max = Math.max(max, (now += d));
  return max;
}

for (const width of [8, 2, 8]) {
  rmSync(log, { force: true });
  setWidth(width);
  const started = Date.now();
  await vitest.runTestSpecifications(specs);
  const rows = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  console.log(
    JSON.stringify({
      pool,
      isolate,
      maxWorkers: width,
      files: rows.length,
      peakOverlap: peak(rows),
      distinctPids: new Set(rows.map((r) => r.pid)).size,
      distinctPoolIds: new Set(rows.map((r) => r.pool)).size,
      wallMs: Date.now() - started,
      serialized: vitest.projects[0].serializedConfig.maxWorkers,
    }),
  );
}
await vitest.close();
