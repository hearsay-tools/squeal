import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

test("reads a data file", () => {
  expect(readFileSync(join(root, "data/input.txt"), "utf8").trim()).toMatch(/^data v/);
});

test("spawns a node script with env {} that spawns a grandchild", async () => {
  const child = spawn(process.execPath, [join(root, "scripts/child.mjs")], { env: {} });
  let out = "";
  child.stdout.on("data", (chunk) => {
    out += String(chunk);
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  expect(code).toBe(0);
  expect(out).toMatch(/^child:grandchild v/);
});

test("starts a Worker", async () => {
  const worker = new Worker(join(root, "scripts/worker.mjs"));
  const message = await new Promise((resolve) => worker.once("message", resolve));
  await worker.terminate();
  expect(message).toMatch(/^worker v/);
});

test("lists a directory", () => {
  expect(readdirSync(join(root, "data/listed")).length).toBeGreaterThan(0);
});
