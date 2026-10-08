import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

const N = 50;
const data = Object.fromEntries(Array.from({ length: N }, (_, i) => [`d${i}.txt`, "x"]));
/** A Worker that only listens. */
const IDLE = `new Worker("require('node:worker_threads').parentPort.on('message', () => {})", { eval: true })`;
const expectAll = (paths: string[]) => {
  for (let i = 0; i < N; i++) expect(paths).toContain(`d${i}.txt`);
};

// A message to a Worker this process or thread started never stops the sender:
// no append before it (task 001-147; 001-143 found 238 such appends in a tsx child).
describe("observe recorder, the flush before a message (task 001-147)", { timeout: 60_000 }, () => {
  it("makes no append per message a main thread posts", () => {
    const seen = observe({
      "main.mjs": [
        'import { readFileSync } from "node:fs";',
        'import { MessageChannel, Worker } from "node:worker_threads";',
        `const w = ${IDLE};`,
        "const { port1 } = new MessageChannel();",
        `for (let i = 0; i < ${N}; i++) {`,
        '  readFileSync(new URL("./d" + i + ".txt", import.meta.url));',
        "  w.postMessage(i);",
        "  port1.postMessage(i);",
        "}",
        "port1.close();",
        "await w.terminate();",
      ].join("\n"),
      ...data,
    });
    expectAll(seen.paths);
    expect(seen.appends).toBeLessThan(5);
  });

  it("makes no append per message a thread posts to its own Worker, and one before each to its parent", () => {
    const seen = observe({
      "main.mjs": [
        'import { Worker } from "node:worker_threads";',
        'const w = new Worker(new URL("./t.mjs", import.meta.url));',
        `for (let i = 0; i < ${N}; i++) await new Promise((r) => w.once("message", r));`,
        "await w.terminate();",
      ].join("\n"),
      "t.mjs": [
        'import { readFileSync } from "node:fs";',
        'import { parentPort, Worker } from "node:worker_threads";',
        `const inner = ${IDLE};`,
        `for (let i = 0; i < ${N}; i++) {`,
        '  readFileSync(new URL("./d" + i + ".txt", import.meta.url));',
        "  inner.postMessage(i);",
        "}",
        "await inner.terminate();",
        // the parent stops this thread at its last message: what it read before must be written
        `for (let i = 0; i < ${N}; i++) {`,
        '  readFileSync(new URL("./e" + i + ".txt", import.meta.url));',
        "  parentPort.postMessage(i);",
        "}",
        "await new Promise(() => setInterval(() => {}, 1000));",
      ].join("\n"),
      ...data,
      ...Object.fromEntries(Array.from({ length: N }, (_, i) => [`e${i}.txt`, "x"])),
    });
    expectAll(seen.paths);
    for (let i = 0; i < N; i++) expect(seen.paths).toContain(`e${i}.txt`);
    expect(seen.appends).toBeGreaterThanOrEqual(N);
    expect(seen.appends).toBeLessThan(N + 8);
  });
});
