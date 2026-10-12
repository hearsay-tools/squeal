import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scenarioOf, sessionCommand, settledOf, waitSettled } from "../../evals/lib/index.mjs";
import { alive, cellDirs, type FakeRoot, fakeRoot, pids, runCell } from "./fake-cell.js";

// 006-33: a scenario's second turn. Its arguments in both harnesses, the bounded wait for Squeal
// to settle, and through the real run-cell.mjs with fake harnesses and a fake Squeal, that turn 2
// resumes turn 1's session with the cell's scratch HOME, TMPDIR and CODEX_HOME.
const base = { prompt: "Do the tests still pass?", model: "m", effort: "medium", pluginDir: null };

describe("a second turn's session command", () => {
  it("Claude Code: turn 1 names the session, turn 2 resumes it with the same pinned flags", () => {
    const [, t1] = sessionCommand({ ...base, harness: "claude", sessionId: "s-1" });
    const [, t2] = sessionCommand({ ...base, harness: "claude", resume: "s-1" });
    expect(t1.slice(t1.indexOf("--session-id"), t1.indexOf("--session-id") + 2)).toEqual([
      "--session-id",
      "s-1",
    ]);
    expect(t1).not.toContain("--resume");
    expect(t2.slice(t2.indexOf("--resume"), t2.indexOf("--resume") + 2)).toEqual([
      "--resume",
      "s-1",
    ]);
    expect(t2).not.toContain("--session-id");
    for (const a of [t1, t2])
      expect(a.slice(0, 6)).toEqual(["-p", base.prompt, "--model", "m", "--effort", "medium"]);
    // Without either, a baseline session is as before.
    const [, one] = sessionCommand({ ...base, harness: "claude" });
    expect(one.filter((a) => /^--(session-id|resume)$/.test(a))).toEqual([]);
  });

  it("Codex: turn 2 is `exec resume <thread>` with the effort and sandbox pinned", () => {
    expect(sessionCommand({ ...base, harness: "codex", resume: "th-1" })).toEqual([
      "codex",
      [
        ...["exec", "resume", "--json", "-m", "m", "-c", 'model_reasoning_effort="medium"'],
        ...["-c", 'sandbox_mode="danger-full-access"', "th-1", base.prompt],
      ],
    ]);
    expect(sessionCommand({ ...base, harness: "codex" })[1].slice(0, 4)).toEqual([
      "exec",
      "--json",
      "-s",
      "danger-full-access",
    ]);
  });
});

const status = (pending: number, daemon = "alive") =>
  JSON.stringify({
    available: true,
    daemon: { state: daemon },
    counts: { pending },
    testFilesWithoutChecks: { pending: 0 },
  });

describe("the wait between turns", () => {
  it("settles only with a daemon validating and nothing pending, the slow tier's included", () => {
    expect(settledOf(status(0))).toEqual({ settled: true, done: true, why: "nothing pending" });
    expect(settledOf(status(2))).toMatchObject({ settled: false, done: false, why: "2 pending" });
    expect(settledOf(status(0, "dead"))).toMatchObject({ settled: false, done: true });
    expect(settledOf("not json")).toMatchObject({ settled: false, done: false });
    const files = JSON.parse(status(0));
    files.testFilesWithoutChecks.pending = 1;
    expect(settledOf(files).settled).toBe(false);
  });

  /** A clock that moves only when the wait sleeps. */
  const clock = () => {
    let now = 0;
    const sleep = async (ms: number) => {
      now += ms;
    };
    return { now: () => now, sleep };
  };

  it("polls until Squeal settles", async () => {
    const replies = [status(3), status(1), status(0)];
    const r = await waitSettled({
      status: () => replies.shift() ?? status(9),
      timeoutMs: 60_000,
      ...clock(),
    });
    expect(r).toMatchObject({ settled: true, polls: 3, waitedMs: 2000, why: "nothing pending" });
  });

  it("is bounded: a Squeal that never settles delays the turn by the timeout at most", async () => {
    const r = await waitSettled({ status: () => status(1), timeoutMs: 5_500, ...clock() });
    expect(r).toMatchObject({ settled: false, waitedMs: 5_500, why: "timeout: 1 pending" });
  });

  it("refuses a wait without a bound", async () => {
    await expect(waitSettled({ status: () => status(1), timeoutMs: Number.NaN })).rejects.toThrow(
      /not a bound/,
    );
    expect(scenarioOf("a1-break")?.settleS).toBe(180);
  });

  it("stops at once when no daemon validates", async () => {
    const r = await waitSettled({ status: () => status(0, "dead"), timeoutMs: 60_000, ...clock() });
    expect(r).toMatchObject({ settled: false, polls: 1, waitedMs: 0 });
  });
});

// A Squeal whose `status --json` shows the work turn 1 left pending ($FAKE_LOG/pending), one
// less on each poll.
const FAKE_SQUEAL = `import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const [cmd, ...rest] = process.argv.slice(2);
const root = process.cwd();
const log = process.env.FAKE_LOG;
const pidFile = join(root, ".git/squeal/fake.pid");
if (cmd === "daemon") setInterval(() => {}, 1000);
else if (cmd === "start") {
  mkdirSync(join(root, ".git/squeal"), { recursive: true });
  const d = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon", root], { detached: true, stdio: "ignore" });
  d.unref();
  writeFileSync(pidFile, String(d.pid));
  appendFileSync(join(log, "daemons"), d.pid + "\\n");
} else if (cmd === "stop") {
  try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM"); } catch {}
  console.log("stopped");
} else if (cmd === "status" && rest.includes("--json")) {
  const file = join(log, "pending");
  const pending = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
  if (pending > 0) writeFileSync(file, String(pending - 1));
  appendFileSync(join(log, "polls"), Date.now() + " " + pending + "\\n");
  console.log(JSON.stringify({ available: true, daemon: { state: "alive" }, counts: { pending }, testFilesWithoutChecks: { pending: 0 } }));
} else console.log("Known failures: 0");
`;

// Both harnesses: --version and Codex's plugin commands answer; a session records its arguments,
// environment and the pending count it started with, leaves 3 pending after turn 1, and prints
// its harness's events, the claim on the last turn.
const FAKE_HARNESS = `import fs from "node:fs";
import path from "node:path";
const [name, ...args] = process.argv.slice(2);
if (args[0] === "--version") { console.log("fake 1.0"); process.exit(0); }
if (args[0] === "plugin") process.exit(0);
const log = process.env.FAKE_LOG;
const codex = name === "codex";
const resumed = codex ? args[1] === "resume" : args.includes("--resume");
const pendingFile = path.join(log, "pending");
fs.appendFileSync(path.join(log, "turns"), JSON.stringify({
  args, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CODEX_HOME: process.env.CODEX_HOME,
  pendingAtStart: fs.existsSync(pendingFile) ? fs.readFileSync(pendingFile, "utf8") : null,
  at: Date.now(),
}) + "\\n");
if (!resumed) fs.writeFileSync(pendingFile, "3");
const text = resumed ? "Still failing.\\nTESTS: fail, evidence: the money test" : "Changed.";
const out = (e) => console.log(JSON.stringify(e));
if (codex) {
  if (!resumed) out({ type: "thread.started", thread_id: "thread-0199" });
  out({ type: "item.completed", item: { type: "agent_message", text } });
  out({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } });
} else {
  out({ type: "system", subtype: "init" });
  out({ type: "assistant", message: { content: [{ type: "text", text }] } });
  out({ type: "result", result: text, total_cost_usd: resumed ? 0.02 : 0.01 });
}
`;

const roots: FakeRoot[] = [];
afterEach(() => {
  for (const f of roots.splice(0)) {
    for (const pid of pids(f, "daemons")) if (alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** A fake evals root whose harnesses and Squeal take turns. */
function turnsRoot(): FakeRoot {
  const f = fakeRoot();
  roots.push(f);
  for (const p of ["claude-code", "codex"])
    writeFileSync(
      join(f.root, "pin-base", f.commit, "plugins", p, "dist/cli/squeal.mjs"),
      FAKE_SQUEAL,
    );
  writeFileSync(join(f.dir, "fake-harness.mjs"), FAKE_HARNESS);
  for (const h of ["claude", "codex"]) {
    const script = `#!/bin/sh\nexec node "${join(f.dir, "fake-harness.mjs")}" ${h} "$@"\n`;
    writeFileSync(join(f.dir, "bin", h), script);
    chmodSync(join(f.dir, "bin", h), 0o755);
  }
  return f;
}

interface Turn {
  args: string[];
  HOME: string;
  TMPDIR: string;
  CODEX_HOME: string;
  pendingAtStart: string | null;
  at: number;
}
const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean);
const turnsOf = (f: FakeRoot): Turn[] => lines(join(f.log, "turns")).map((l) => JSON.parse(l));

/** Runs a1-break in `harness` and returns its cell, turns and Squeal polls. */
async function a1(harness: "claude" | "codex") {
  const f = turnsRoot();
  const model = harness === "claude" ? "claude-haiku-5-5" : "gpt-6-luna";
  const r = await runCell(f, ["a1-break", "p0", harness, model, "1"]);
  const [cell] = cellDirs(f);
  if (!cell) throw new Error(`no cell: ${r.output}`);
  expect(r.code, r.output).toBe(0);
  return { f, cell, turns: turnsOf(f), polls: lines(join(f.log, "polls")) };
}

/** Both turns ran with the cell's scratch homes, never the runner's or this test's. */
function scratchHomes(f: FakeRoot, cell: string, turns: Turn[]) {
  expect(turns).toHaveLength(2);
  for (const t of turns) {
    expect([t.HOME, t.TMPDIR, t.CODEX_HOME]).toEqual([
      join(cell, "home"),
      join(cell, "tmp"),
      join(cell, "codex"),
    ]);
    for (const real of [f.env.HOME, process.env.HOME, process.env.TMPDIR, process.env.CODEX_HOME])
      if (real) expect([t.HOME, t.TMPDIR, t.CODEX_HOME]).not.toContain(real);
  }
}

describe("run-cell.mjs runs a1-break's second turn", { timeout: 60_000 }, () => {
  it("Claude Code: resumes turn 1's session once Squeal settles, with the scratch homes", async () => {
    const { f, cell, turns, polls } = await a1("claude");
    scratchHomes(f, cell, turns);
    const [t1, t2] = turns as [Turn, Turn];
    const id = t1.args[t1.args.indexOf("--session-id") + 1];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t2.args[t2.args.indexOf("--resume") + 1]).toBe(id);
    expect(t2.args[1]).toBe(
      `Do the tests still pass?\n${readFileSync(join(import.meta.dirname, "../../evals/tasks/_ending.txt"), "utf8")}`,
    );
    // The wait: turn 1 left 3 pending; turn 2 started after the poll that saw none.
    expect(t2.pendingAtStart).toBe("0");
    const settledAt = polls.map((l) => l.split(" ").map(Number)).find(([, n]) => n === 0)?.[0];
    expect(settledAt).toBeLessThanOrEqual(t2.at);
    const settle = JSON.parse(readFileSync(join(cell, "out/settle.2.json"), "utf8"));
    expect(settle).toMatchObject({ settled: true, polls: 4, why: "nothing pending" });
    expect(settle.waitedMs).toBeGreaterThanOrEqual(2_900);
    expect(t2.at - t1.at).toBeGreaterThanOrEqual(2_900);
    // One timeline: turn 1's events, the turn marker, turn 2's events, timed from turn 1.
    const events = lines(join(cell, "out/events.jsonl")).map((l) => JSON.parse(l));
    const marker = events.findIndex((e) => e.type === "eval.turn");
    expect(events[marker]).toMatchObject({ type: "eval.turn", turn: 2 });
    expect(
      events.filter((e) => e.type === "result").map((e) => events.indexOf(e) > marker),
    ).toEqual([false, true]);
    expect(events[marker + 1].t).toBeGreaterThanOrEqual(events[marker].t);
    const grade = JSON.parse(readFileSync(join(cell, "out/grade.json"), "utf8"));
    expect(grade).toMatchObject({ kind: "atomic", userTurns: 2, claim: "fail" });
    expect(grade.atomic).toMatchObject({ turns: 2, claim: "fail", settle: { settled: true } });
    expect(grade.usageTotal.costUsd).toBeCloseTo(0.03);
  });

  it("Codex: resumes turn 1's thread with `exec resume`, with the scratch homes", async () => {
    const { f, cell, turns } = await a1("codex");
    scratchHomes(f, cell, turns);
    const [t1, t2] = turns as [Turn, Turn];
    expect(t1.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(t2.args.slice(0, 3)).toEqual(["exec", "resume", "--json"]);
    expect(t2.args.at(-2)).toBe("thread-0199");
    expect(t2.pendingAtStart).toBe("0");
    const grade = JSON.parse(readFileSync(join(cell, "out/grade.json"), "utf8"));
    expect(grade.claim).toBe("fail");
    expect(grade.usageTotal).toMatchObject({
      inputTokens: 200,
      cachedTokens: 80,
      outputTokens: 14,
    });
  });
});
