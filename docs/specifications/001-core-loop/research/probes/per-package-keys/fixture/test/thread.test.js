import { Worker } from "node:worker_threads";
import { expect, test } from "vitest";
test("thread", async () => {
  const w = new Worker("const { parentPort } = require('node:worker_threads'); parentPort.postMessage(require('child-pkg').child());", { eval: true });
  expect(await new Promise((r) => w.once("message", r))).toBe("child-v1");
});
