import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SlotPool } from "../../../src/core/code/gate/lanes.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Spec 020 D18 as amended (row 020-44) and row 020-43: the gate's hooks in
 * the node:test run loop. A run takes a slot of a shared pool before each
 * file's process starts and gives it back as it exits, so two entries' runs
 * at once never start more processes than the pool holds; and it tells
 * each file's start, and its end through what the start returned. A fake
 * Node that sleeps stands for each file, so no test depends on the host.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-slots-"))) as AbsolutePath;
afterAll(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, "test"), { recursive: true });
const node = join(root, "node-that-sleeps");
writeFileSync(node, "#!/bin/sh\nsleep 0.3\n");
chmodSync(node, 0o755);

const projectOf = (name: string): NodeTestProject => ({
  name,
  node,
  argv: [],
  env: {},
  include: ["test/*.mjs"],
});
const files = (project: string, names: readonly string[]): TestFileRef[] =>
  names.map((name) => {
    writeFileSync(join(root, "test", `${name}.mjs`), "");
    return { project, path: `test/${name}.mjs` };
  });
const logDir = (name: string) => {
  const dir = join(root, "logs", name);
  mkdirSync(dir, { recursive: true });
  return dir as AbsolutePath;
};

describe("runNodeTest with the gate's pool and start hook (rows 020-43, 020-44)", () => {
  it("starts no more processes than the shared pool holds, and tells each start and end", async () => {
    const pool = new SlotPool(2);
    let held = 0;
    let most = 0;
    const slots = async (signal: AbortSignal) => {
      const release = await pool.take(signal);
      if (release === null) return null;
      held += 1;
      most = Math.max(most, held);
      return () => {
        held -= 1;
        release();
      };
    };
    const told: string[] = [];
    const fileStarted = (ref: TestFileRef) => {
      told.push(`start ${ref.path}`);
      return () => told.push(`end ${ref.path}`);
    };
    const one = files("one", ["a1", "a2", "a3"]);
    const two = files("two", ["b1", "b2"]);
    const run = (name: string, refs: readonly TestFileRef[]) =>
      runNodeTest({
        root,
        project: projectOf(name),
        files: refs,
        logDir: logDir(name),
        timeoutMs: 60_000,
        // Each entry alone would start all its files at once.
        concurrency: 3,
        slots,
        fileStarted,
      });

    await Promise.all([run("one", one), run("two", two)]);

    expect(most).toBe(2);
    expect(held).toBe(0);
    for (const ref of [...one, ...two]) {
      const start = told.indexOf(`start ${ref.path}`);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(told.indexOf(`end ${ref.path}`)).toBeGreaterThan(start);
      expect(told.filter((line) => line.endsWith(` ${ref.path}`))).toHaveLength(2);
    }
    // The pool hands slots out in the order asked: the first run's two files start first.
    expect(told.slice(0, 2)).toEqual(["start test/a1.mjs", "start test/a2.mjs"]);
  });

  it("starts no file when no slot frees before the deadline", async () => {
    const pool = new SlotPool(1);
    const taken = await pool.take(new AbortController().signal);
    const started: string[] = [];
    const report = await runNodeTest({
      root,
      project: projectOf("starved"),
      files: files("starved", ["c1", "c2"]),
      logDir: logDir("starved"),
      timeoutMs: 300,
      slots: pool.take,
      fileStarted: (ref) => {
        started.push(ref.path);
        return () => {};
      },
    });

    expect(started).toEqual([]);
    expect(report.report.end).toBe("timed-out");
    expect(report.report.completedFiles).toEqual([]);
    // The aborted waits left the pool: the slot goes back to it, not to them.
    taken?.();
    expect(await pool.take(AbortSignal.abort())).toBeNull();
    const again = await pool.take(new AbortController().signal);
    expect(again).not.toBeNull();
  });

  // Review 0.1.464 S1: the slot goes back to the pool when the start or the end hook throws.
  it.each([
    { hook: "start", fileStarted: (): (() => void) => thrower("start hook threw")() },
    { hook: "end", fileStarted: (): (() => void) => thrower("end hook threw") },
  ])("gives its slot back when the $hook hook throws", async ({ hook, fileStarted }) => {
    const pool = new SlotPool(1);
    const run = runNodeTest({
      root,
      project: projectOf(`throws-${hook}`),
      files: files(`throws-${hook}`, [`d-${hook}`]),
      logDir: logDir(`throws-${hook}`),
      timeoutMs: 60_000,
      slots: pool.take,
      fileStarted,
    });

    await expect(run).rejects.toThrow(`${hook} hook threw`);
    // A free slot is given at once; a leaked one leaves the wait to its abort.
    const waiting = new AbortController();
    const next = pool.take(waiting.signal);
    waiting.abort();
    expect(await next).not.toBeNull();
  });
});

const thrower = (message: string) => () => {
  throw new Error(message);
};
