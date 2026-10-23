import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { claudeRunner, killRunning } from "../../evals/lib/index.mjs";
import { alive } from "./fake-cell.js";

// 006-98: a judge call runs in a process group of its own, which its timeout and a runner's
// teardown (killRunning) end whole. A shell stands in for `claude`: it and a child of its own
// ignore SIGTERM and log their pids. Its tests run in order: once one has called killRunning,
// no judge call starts.

const root = mkdtempSync(join(tmpdir(), "squeal-judge-kill-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const base = mkdtempSync(join(root, "base-"));
const script = join(root, "fake-claude.sh");
writeFileSync(
  script,
  `trap '' TERM
sh -c 'trap "" TERM; echo $$ >> "$PIDS"; while :; do sleep 1; done' &
echo $$ >> "$PIDS"
while :; do sleep 1; done
`,
);

/** A runner whose calls log their pids to `name` under the root. */
const runner = (name: string, limits: { timeoutMs?: number; graceMs?: number } = {}) => {
  const log = join(root, name);
  const parent = { PATH: process.env.PATH, PIDS: log };
  const run = claudeRunner({ base, parent, command: "sh", prefix: [script], ...limits });
  const pids = () =>
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map(Number) : [];
  return { run, pids };
};

const started = async (pids: () => number[]) =>
  vi.waitFor(() => expect(pids()).toHaveLength(2), { timeout: 10_000, interval: 20 });

describe("a judge call's process group", () => {
  it("ends whole at the call's timeout", async () => {
    const { run, pids } = runner("timeout", { timeoutMs: 300, graceMs: 200 });
    const r = await run({ args: ["-p"] });
    expect(r.status).toBeNull();
    expect(r.stderr).toMatch(/timeout after 300 ms[\s\S]*SIGKILL to the process group/);
    expect(pids()).toHaveLength(2);
    // The shell's child too, which a SIGKILL to the shell alone left running.
    await vi.waitFor(() => expect(pids().filter(alive)).toEqual([]), { timeout: 2_000 });
    expect(readdirSync(base)).toEqual([]);
  });

  it("ends whole at the runner's teardown, which waits for it", async () => {
    const { run, pids } = runner("teardown");
    const call = run({ args: ["-p"], input: "[1] final message:\nDone." });
    await started(pids);
    await killRunning("SIGKILL");
    expect(pids().filter(alive)).toEqual([]);
    expect(readdirSync(base)).toEqual([]);
    expect((await call).status).toBeNull();
  });

  it("does not start after the teardown has begun", async () => {
    const { run, pids } = runner("after");
    const r = await run({ args: ["-p"] });
    expect(r.status).toBeNull();
    expect(r.stderr).toBe(`the teardown has begun: sh ${script} not started\n`);
    expect(pids()).toEqual([]);
    expect(readdirSync(base)).toEqual([]);
  });
});
