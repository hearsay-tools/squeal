import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { squealRepo } from "../harness/helpers.js";

const saved = { ...process.env };
let runtimeDir: string;
const servers: Server[] = [];

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

type Answer = Record<string, unknown>;

/**
 * A stand-in daemon. `answers` maps a request type to its answers in order;
 * the last one repeats. Resolves to the request types it got, in order.
 */
function fakeDaemon(path: string, answers: Record<string, Answer[]>): Promise<string[]> {
  const seen: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const request = JSON.parse(data.toString()) as { type: string };
        seen.push(request.type);
        const queue = answers[request.type] ?? [{ ok: true, type: request.type }];
        const answer = (queue.length > 1 ? queue.shift() : queue[0]) as Answer;
        socket.end(`${JSON.stringify({ schemaVersion: 1, ...answer })}\n`);
      });
    });
    servers.push(server);
    server.listen(path, () => resolve(seen));
  });
}

function slow(requested: { revision: number; queued: number } | null, error: string | null = null) {
  return { ok: true, type: "run-slow", requestId: "s1", requested, error };
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

describe("squeal run --slow (spec 004 D2, explicit trigger)", () => {
  it("prints how many slow files the scheduler queued, once it took the request", async () => {
    const r = squealRepo();
    const seen = await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [slow(null)],
      "run-slow-status": [slow(null), slow({ revision: 5, queued: 2 })],
    });

    expect(await run(["run", "--slow"], r.root)).toEqual({
      code: 0,
      stdout:
        "Slow tier requested at revision 5: 2 slow files queued; they run once no fast work is pending.\n",
      stderr: "",
    });
    expect(seen.filter((type) => type !== "ping")).toEqual([
      "run-slow",
      "run-slow-status",
      "run-slow-status",
    ]);
  });

  it("says when there is no slow file to run", async () => {
    const r = squealRepo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [slow({ revision: 5, queued: 0 })],
    });

    expect(await run(["run", "--slow"], r.root)).toMatchObject({
      code: 0,
      stdout:
        "No slow files to run at revision 5: none are declared in squeal.config.json or all are current.\n",
    });
  });

  it("exits 1 and says so when the daemon's scheduler has no slow tier", async () => {
    const r = squealRepo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [slow(null)],
      "run-slow-status": [slow(null, "run --slow is not supported by this daemon")],
    });

    expect(await run(["run", "--slow"], r.root)).toEqual({
      code: 1,
      stdout: "",
      stderr: "squeal: run --slow is not supported by this daemon\n",
    });
  });

  it("exits 1 and says so when the daemon predates the request", async () => {
    const r = squealRepo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [{ ok: false, error: 'unknown request type "run-slow"' }],
    });

    expect(await run(["run", "--slow"], r.root)).toEqual({
      code: 1,
      stdout: "",
      stderr: "squeal: run --slow is not supported by this daemon\n",
    });
  });

  it("exits 1 without a daemon", async () => {
    const r = squealRepo();
    expect(await run(["run", "--slow"], r.root)).toMatchObject({
      code: 1,
      stderr: `squeal: no daemon running for ${r.root}; start one with squeal start\n`,
    });
  });

  it("with --wait <ms>, waits as status --wait does and prints status", async () => {
    const r = squealRepo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [slow({ revision: 5, queued: 1 })],
    });

    const result = await run(["run", "--slow", "--wait", "800"], r.root);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^Slow tier requested at revision 5: 1 slow file queued; [^\n]*\nReturned [^\n]*\n\nRevision/,
    );
  });

  it("rejects --slow with --all or --force, and --wait without milliseconds", async () => {
    const r = squealRepo();
    for (const argv of [
      ["run", "--slow", "--all"],
      ["run", "--slow", "--force"],
      ["run", "--slow", "--wait"],
      ["run", "--slow", "--wait", "soon"],
      ["run"],
    ]) {
      const result = await run(argv, r.root);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.stderr, argv.join(" ")).toContain("usage: squeal run --all");
      expect(result.stderr, argv.join(" ")).toContain("squeal run --slow [--wait <ms>]");
    }
  });
});
