import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRecorded } from "../../../src/core/ci/inputs.js";
import { fill, run, temp } from "./ci-evidence-kit.js";

/*
 * Row 018-29 (spec 018 D8): each process and thread of a recorded command
 * writes the time Squeal's hooks took there (`clock.cjs`) beside its
 * evidence, so `ci record` can sum it. A process stopped without its exit
 * loses at most the last `DUE_MS` of it.
 */

/** Every line of every evidence file in `dir`, parsed. */
function lines(dir: string): Record<string, unknown>[] {
  return readdirSync(dir).flatMap((name) =>
    readFileSync(join(dir, name), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
}

describe("the CI hook's clock (row 018-29)", () => {
  it("writes each process's and thread's time beside its evidence, the evidence unchanged", () => {
    const root = join(temp(), "root");
    fill(root, {
      "data/a.txt": "a",
      "worker.cjs": `require("node:fs").readFileSync("data/a.txt");\n`,
      "script.mjs": `import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
for (let i = 0; i < 200; i++) readFileSync("data/a.txt");
const worker = new Worker(new URL("./worker.cjs", import.meta.url));
await new Promise((done) => worker.on("exit", done));
`,
    });
    const evidence = temp();
    run(root, { evidence });
    const { hooks, evidence: read } = readRecorded(evidence);
    expect(read["data/a.txt"]).toEqual(expect.any(String));
    expect(hooks.threads).toBe(2);
    expect(hooks.ms).toBeGreaterThan(0);
    for (const line of lines(evidence)) expect(line.o).toEqual(expect.any(Number));
  });

  it("writes the time of a turn that took no new evidence before the process is killed", () => {
    const root = join(temp(), "root");
    fill(root, {
      "data/a.txt": "a",
      // The first read's evidence goes out in its own turn; the reads of the next turn add
      // no evidence (the same content), only time; then the process dies without its exit.
      "script.mjs": `import { statSync } from "node:fs";
statSync("data/a.txt");
setTimeout(() => {
  const until = performance.now() + 100;
  while (performance.now() < until) statSync("data/a.txt");
  setTimeout(() => process.kill(process.pid, "SIGKILL"), 50);
}, 50);
`,
    });
    const evidence = temp();
    expect(() => run(root, { evidence })).toThrow();
    const written = lines(evidence);
    expect(written.filter((line) => "e" in line)).toHaveLength(1);
    const alone = written.filter((line) => Object.keys(line).join() === "o");
    expect(alone.length).toBeGreaterThan(0);
    // Most of the 100 ms loop is the hook's: far more than the first turn's single read.
    expect(readRecorded(evidence).hooks.ms).toBeGreaterThan(20);
  });
});
