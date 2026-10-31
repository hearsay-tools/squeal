import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bridgeDeps, prompt, register } from "../../../src/harness/opencode/bridge.js";
import { callBridge } from "../../../src/harness/opencode/bridge-client.js";
import { after } from "../../../src/harness/opencode/bridge-turn.js";
import { VERDICT_SIGNAL } from "../../../src/harness/opencode/bridge-verdict.js";
import type { OcConsumer } from "../../../src/harness/opencode/protocol.js";
import type { HookDeps } from "../../../src/harness/shared/hook.js";
import { tempDir } from "../../store/helpers.js";
import { SESSION, type SquealRepo, squealRepo } from "../helpers.js";

/*
 * Row 011-288 (011 C8 as amended 2026-10-31): an OpenCode report commits
 * only when the plugin read the bridge's answer before its deadline. A
 * bridge whose answer, its report prepared, is not out by the deadline is
 * killed with its report rolled back: the next boundary tells the transition
 * once, and the one after it does not repeat it. This is the reverse of the
 * third case of `research/ci-opencode-continued.md` (a Stop held after its
 * delivery, past the 500 ms idle deadline), and of row 011-288's research.
 */

const TRANSITION = "PASS -> FAIL";
/** D4: the idle deadline at the default `stop.waitMs` of 0. */
const IDLE_DEADLINE_MS = 500;
/** D4: a tool boundary's. */
const TOOL_DEADLINE_MS = 2_000;
const ROOT: OcConsumer = { sessionId: SESSION };

/** The real bridge of `kind`, its answer's write stalled for a request with `stallMark`. */
async function bridgeEntry(dir: string, kind: "after" | "stop"): Promise<string> {
  const src = (path: string) => JSON.stringify(resolve("src/harness/opencode", path));
  const code = `
    import { readFileSync, writeFileSync } from "node:fs";
    import { runBridge } from ${src("bridge.ts")};
    import { ${kind} as handler } from ${src("bridge-turn.ts")};
    const stdin = readFileSync(0, "utf8");
    const mark = JSON.parse(stdin).stallMark;
    if (typeof mark === "string") {
      // The answer reached its write, so the report was prepared; the write never completes.
      process.stdout.write = (text) => {
        writeFileSync(mark, String(text));
        return false;
      };
    }
    await runBridge(stdin, new URL(import.meta.url), ${JSON.stringify(kind)}, handler);
  `;
  const outfile = join(dir, `${kind}.mjs`);
  await build({
    stdin: { contents: code, resolveDir: process.cwd(), loader: "ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return outfile;
}

/** A bridge whose `ping` handler marks its start at `started` and answers 400 ms later. */
async function slowPing(dir: string): Promise<string> {
  const code = `
    import { readFileSync, writeFileSync } from "node:fs";
    import { setTimeout as sleep } from "node:timers/promises";
    import { runBridge } from ${JSON.stringify(resolve("src/harness/opencode/bridge.ts"))};
    const stdin = readFileSync(0, "utf8");
    await runBridge(stdin, new URL(import.meta.url), "ping", async (request) => {
      writeFileSync(request.started, "");
      await sleep(400);
      return { pong: true };
    });
  `;
  const outfile = join(dir, "slow-ping.mjs");
  await build({
    stdin: { contents: code, resolveDir: process.cwd(), loader: "ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  return outfile;
}

/** Built once for the file: `tempDir` is removed after each test. */
const entries: { dir?: string; after?: string; stop?: string; ping?: string } = {};
beforeAll(async () => {
  entries.dir = mkdtempSync(join(tmpdir(), "squeal-oc-held-"));
  entries.after = await bridgeEntry(entries.dir, "after");
  entries.stop = await bridgeEntry(entries.dir, "stop");
  entries.ping = await slowPing(entries.dir);
});
afterAll(() => {
  if (entries.dir !== undefined) rmSync(entries.dir, { recursive: true, force: true });
});

const deps = (): HookDeps => ({
  ...bridgeDeps(new URL("file:///pkg/dist/hooks/after.mjs"), { worktree: "/", pid: process.pid }),
  env: {},
  ensureDaemon: async () => "alive",
});
const about = (r: SquealRepo) => ({ consumer: ROOT, worktree: r.root, pid: process.pid });

/** A registered root session whose check went from PASS to FAIL since, its view still `pass`. */
async function failedSince(): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  await register({ kind: "register", ...about(r) }, deps());
  r.apply(r.fail());
  return r;
}

const viewOf = (r: SquealRepo) =>
  r.store.views.list(r.consumer()).find((v) => v.check.kind === "test")?.outcome;
const count = (text: string | null | undefined) => (text ?? "").split(TRANSITION).length - 1;
const boundary = async (r: SquealRepo) =>
  (await after({ kind: "after", ...about(r), tool: "bash" }, deps())).text;

async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 10));
  }
  return true;
}

/** One request through the real `callBridge` and the built bridge; `stall` holds its answer. */
async function bridged<A>(
  r: SquealRepo,
  kind: "after" | "stop",
  event: object,
  deadlineMs: number,
  stall: boolean,
): Promise<{ answer: A | null; prepared: string | null }> {
  const entry = entries[kind] ?? "";
  const mark = join(tempDir("squeal-oc-mark-"), "prepared");
  const answer = await callBridge<A>(
    { node: process.execPath, entry },
    { ...event, ...(stall ? { stallMark: mark } : {}) },
    r.root,
    deadlineMs,
  );
  return { answer, prepared: existsSync(mark) ? readFileSync(mark, "utf8") : null };
}

describe("OpenCode: a report commits only once the plugin read it in time (row 011-288)", () => {
  it("tells a transition once at a tool boundary and commits it, when its answer is read in time", async () => {
    const r = await failedSince();
    const event = { kind: "after", ...about(r), tool: "bash" };
    const { answer } = await bridged<{ text: string | null }>(
      r,
      "after",
      event,
      TOOL_DEADLINE_MS,
      false,
    );
    expect(count(answer?.text)).toBe(1);
    // The bridge commits at the plugin's verdict, just after the plugin read the answer.
    expect(await until(() => viewOf(r) === "fail", TOOL_DEADLINE_MS)).toBe(true);
    expect(count(await boundary(r))).toBe(0);
  }, 60_000);

  it("keeps a tool boundary's transition owed when its answer misses the deadline", async () => {
    const r = await failedSince();
    const event = { kind: "after", ...about(r), tool: "bash" };
    const run = await bridged(r, "after", event, TOOL_DEADLINE_MS, true);
    expect(run.answer).toBeNull();
    expect(run.prepared).toContain(TRANSITION);
    expect(viewOf(r)).toBe("pass");
    expect(count(await boundary(r))).toBe(1);
    expect(count(await boundary(r))).toBe(0);
  }, 60_000);

  it("keeps a Stop's transition owed past the idle deadline, for the next prompt once", async () => {
    const r = await failedSince();
    const run = await bridged(r, "stop", { kind: "stop", ...about(r) }, IDLE_DEADLINE_MS, true);
    expect(run.answer).toBeNull();
    expect(run.prepared).toContain(TRANSITION);
    expect(viewOf(r)).toBe("pass");
    const next = await prompt({ kind: "prompt", ...about(r) }, deps());
    expect(count(next.text)).toBe(1);
    const then = await prompt({ kind: "prompt", ...about(r) }, deps());
    expect(count(then.text)).toBe(0);
  }, 60_000);
});

describe("an OpenCode bridge and the verdict signal (row 011-288)", () => {
  it("is not killed by a stray verdict signal when its request has no `ack`", async () => {
    const started = join(tempDir("squeal-oc-signal-"), "started");
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", entries.ping ?? ""],
      {
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
      child.on("close", (code, signal) => done({ code, signal })),
    );
    child.stdin.end(JSON.stringify({ kind: "ping", started }));
    expect(await until(() => existsSync(started), 20_000)).toBe(true);
    child.kill(VERDICT_SIGNAL);
    expect(await closed).toEqual({ code: 0, signal: null });
    expect(JSON.parse(stdout)).toEqual({ answer: { pong: true } });
  }, 60_000);
});
