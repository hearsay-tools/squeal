import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { release } from "../../src/core/lint/pass/commit-entry.js";
import { lintScope } from "../../src/core/lint/pass/records.js";
import { isLintStoreOpenFailure, openLintStore } from "../../src/core/lint/store/open.js";
import type { LintOutcome } from "../../src/core/types/lint.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { squealRepo } from "../harness/helpers.js";
import { clientGone, closeFakeDaemons, fakeDaemon, lockStore, received } from "./fake-daemon.js";

/*
 * Row 019-22 (spec 019 D6): `squeal run <group>` for a lint group asks the
 * daemon's `run-group`, and with `--wait` gives the group's verdict from
 * the lint store: 0 with no findings, 1 with findings, 3 with no verdict.
 * Each socket call is bounded by the wait.
 */

const saved = { ...process.env };
let runtimeDir: string;
const servers: { close(): void }[] = [];

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  closeFakeDaemons();
  closeStalling();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A repository whose lint group `lint` is at `at`, `commit` by default, with its lint store's states. */
function repo(states: Record<string, LintOutcome> = {}, at = "commit") {
  const r = squealRepo();
  writeFileSync(
    join(r.root, "squeal.config.json"),
    JSON.stringify({
      lint: { enabled: true, tools: ["eslint"] },
      checks: [{ name: "lint", lint: true, at }],
    }),
  );
  const lint = { ...DEFAULT_POLICY.lint, enabled: true };
  const store = openLintStore(r.repo.commonDir, { lint }, { busyTimeoutMs: 5_000 });
  if (isLintStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const write = (path: string, outcome: LintOutcome, stale = false) =>
    store.states.upsertMany([
      {
        worktreeId: r.worktreeId,
        check: { kind: "lint", path, tool: "eslint" },
        outcome,
        judged: null,
        stale,
        reason: null,
        changedAt: 1,
      },
    ]);
  for (const [path, outcome] of Object.entries(states)) write(path, outcome);
  const scope = lintScope(r.worktreeId, "eslint");
  return {
    ...r,
    mainStore: r.store,
    store,
    write,
    release: (path: string) => release(store.meta, scope, new Map([[path, "b1"]])),
  };
}

const requested = (queued: number) => ({
  ok: true,
  type: "run-group",
  requestId: "g1",
  group: "lint",
  requested: { revision: 3, queued },
  unknown: false,
  error: null,
});

/** Sockets a stand-in holds open without a word. */
const held: Socket[] = [];

/** A stand-in daemon that answers each request by `answer`, or holds it without a word at `null`. */
function stalling(path: string, answer: (type: string) => Record<string, unknown> | null) {
  const server = createServer((socket) => {
    socket.on("error", clientGone);
    socket.once("data", (data) => {
      const { type } = JSON.parse(data.toString()) as { type: string };
      const reply = answer(type);
      if (reply === null) held.push(socket);
      else socket.end(`${JSON.stringify({ schemaVersion: 1, ok: true, type, ...reply })}\n`);
    });
  });
  servers.push(server);
  return new Promise<void>((resolve) => server.listen(path, resolve));
}

function closeStalling(): void {
  for (const socket of held.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
}

/** `run`, and whether it ended within 1.5 s, as the test group's stall tests allow. */
async function timed(argv: string[], cwd: string) {
  const started = performance.now();
  const result = await run(argv, cwd);
  return { ...result, inTime: performance.now() - started < 1_500 };
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

const REQUESTED = "Group lint requested at revision 3: 2 lint checks queued; they lint now.\n";

describe("squeal run <lint group> (019-22)", () => {
  it("asks the daemon's run-group and prints what it queued", async () => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), { "run-group": [requested(2)] });
    expect(await run(["run", "lint"], r.root)).toEqual({ code: 0, stdout: REQUESTED, stderr: "" });
    expect(received.filter((q) => q.type !== "ping")).toEqual([
      { type: "run-group", group: "lint" },
    ]);
  });

  it("--wait gives the lint verdict: 1 with findings, 0 with none", async () => {
    const r = repo({ "src/a.js": "fail", "src/b.js": "pass" });
    await fakeDaemon(socketPathFor(r.worktreeId), { "run-group": [requested(2)] });
    expect(await run(["run", "lint", "--wait", "5000"], r.root)).toEqual({
      code: 1,
      stdout: `Group lint completed: lint findings in 1 of 2 files; \`squeal lint\` lists them\n${REQUESTED}`,
      stderr: "",
    });
    r.write("src/a.js", "pass");
    const passed = await run(["run", "lint", "--wait", "5000"], r.root);
    expect(passed.code).toBe(0);
    expect(passed.stdout.split("\n")[0]).toBe("Group lint completed: no lint findings in 2 files");
  });

  it("--wait waits for a released check, and has no verdict for one an edit left to a commit", async () => {
    const r = repo({ "src/a.js": "pending", "src/b.js": "pass" });
    r.release("src/a.js");
    await fakeDaemon(socketPathFor(r.worktreeId), { "run-group": [requested(1)] });
    setTimeout(() => r.write("src/a.js", "pass"), 300);
    const linted = await run(["run", "lint", "--wait", "10000"], r.root);
    expect(linted.code).toBe(0);
    expect(linted.stdout.split("\n")[0]).toBe("Group lint completed: no lint findings in 2 files");

    r.write("src/a.js", "pending");
    const late = await run(["run", "lint", "--wait", "1200"], r.root);
    expect(late.code).toBe(3);
    expect(late.stdout.split("\n")[0]).toBe(
      "Group lint has no verdict: the deadline passed with 1 lint check pending; the group goes on in the daemon",
    );

    r.store.meta.delete(`lint-release:${lintScope(r.worktreeId, "eslint")}`);
    const held = await run(["run", "lint", "--wait", "5000"], r.root);
    expect(held.code).toBe(3);
    expect(held.stdout.split("\n")[0]).toBe(
      "Group lint has no verdict: 1 lint check changed after the request and waits for a commit",
    );
  });

  // Row 019-47: at `manual` a check edited after the request waits for the next request, never for a commit.
  it("--wait has no verdict at `manual` for a check an edit left to the next request", async () => {
    const r = repo({ "src/a.js": "pending", "src/b.js": "pass" }, "manual");
    await fakeDaemon(socketPathFor(r.worktreeId), { "run-group": [requested(1)] });
    const held = await run(["run", "lint", "--wait", "5000"], r.root);
    expect(held.code).toBe(3);
    expect(held.stdout.split("\n")[0]).toBe(
      "Group lint has no verdict: 1 lint check changed after the request and waits for another `squeal run lint`",
    );
  });

  it("--wait counts a released stale check as pending until it is linted again (019-26, B1)", async () => {
    // A whole-program file keeps its outcome while stale: the old result is not the verdict.
    const r = repo({ "src/b.js": "pass" });
    r.write("src/a.js", "pass", true);
    r.release("src/a.js");
    await fakeDaemon(socketPathFor(r.worktreeId), { "run-group": [requested(1)] });
    const unresolved = await run(["run", "lint", "--wait", "1200"], r.root);
    expect(unresolved.code).toBe(3);
    expect(unresolved.stdout.split("\n")[0]).toBe(
      "Group lint has no verdict: the deadline passed with 1 lint check pending; the group goes on in the daemon",
    );

    setTimeout(() => r.write("src/a.js", "pass"), 300);
    const linted = await run(["run", "lint", "--wait", "10000"], r.root);
    expect(linted.code).toBe(0);
    expect(linted.stdout.split("\n")[0]).toBe("Group lint completed: no lint findings in 2 files");

    r.write("src/a.js", "fail", true);
    setTimeout(() => r.write("src/a.js", "fail"), 300);
    const failed = await run(["run", "lint", "--wait", "10000"], r.root);
    expect(failed.code).toBe(1);
    expect(failed.stdout.split("\n")[0]).toBe(
      "Group lint completed: lint findings in 1 of 2 files; `squeal lint` lists them",
    );
  });

  it("--wait has no verdict for a stale check no request released", async () => {
    const r = repo({ "src/b.js": "pass" });
    r.write("src/a.js", "fail", true);
    await fakeDaemon(socketPathFor(r.worktreeId), { "run-group": [requested(1)] });
    const held = await run(["run", "lint", "--wait", "5000"], r.root);
    expect(held.code).toBe(3);
    expect(held.stdout.split("\n")[0]).toBe(
      "Group lint has no verdict: 1 lint check changed after the request and waits for a commit",
    );
  });

  it("with no daemon, or one that does not answer, has no verdict within the wait", async () => {
    const r = repo();
    expect(await run(["run", "lint", "--wait", "1000"], r.root)).toMatchObject({
      code: 3,
      stdout: "Group lint has no verdict: no daemon is running; start one with squeal start\n",
    });
    expect((await run(["run", "lint"], r.root)).code).toBe(1);

    await stalling(socketPathFor(r.worktreeId), (type) => (type === "ping" ? {} : null));
    expect(await timed(["run", "lint", "--wait", "300"], r.root)).toEqual({
      code: 3,
      stdout:
        "Group lint has no verdict: the daemon did not answer the request to run group lint before the deadline; it may still take it once its current work allows\n",
      stderr: "",
      inTime: true,
    });
  });

  it("bounds the daemon's discovery and the status polls by the wait (019-26, B3)", async () => {
    const r = repo();
    await stalling(socketPathFor(r.worktreeId), () => null);
    const silent = await timed(["run", "lint", "--wait", "300"], r.root);
    expect(silent).toMatchObject({ code: 3, stderr: "", inTime: true });
    expect(silent.stdout).toMatch(/^Group lint has no verdict: the daemon did not answer/);

    closeStalling();
    const pending = { ...requested(0), requested: null };
    await stalling(socketPathFor(r.worktreeId), (type) =>
      type === "ping" ? {} : type === "run-group" ? pending : null,
    );
    expect(await timed(["run", "lint", "--wait", "300"], r.root)).toEqual({
      code: 3,
      stdout: `Group lint has no verdict: the deadline passed before the daemon took request g1; this daemon does not say what holds it. ${STAYS}\n`,
      stderr: "",
      inTime: true,
    });
  });

  // Row 011-302: the pending answer names what holds the request, as the daemon recorded it.
  it("names the holder of a request the deadline passed", async () => {
    const r = repo();
    const holder = {
      kind: "scheduler",
      operation: "applying revision 412",
      heldMs: 48_400,
      step: null,
    };
    const pending = { ...requested(0), requested: null, holder };
    await stalling(socketPathFor(r.worktreeId), (type) => (type === "ping" ? {} : pending));
    expect(await timed(["run", "lint", "--wait", "300"], r.root)).toEqual({
      code: 3,
      stdout: `Group lint has no verdict: the deadline passed before the daemon took request g1; it waits for the scheduler, which has been applying revision 412 for 48 s. ${STAYS}\n`,
      stderr: "",
      inTime: true,
    });
  });

  // gh-154: the main thread stalled for 111 s with no holder recorded, while the socket answered.
  it("says the daemon's main thread sent no heartbeat, with no holder recorded", async () => {
    const r = repo();
    r.daemon("stale", Date.now() - 111_000);
    const pending = { ...requested(0), requested: null };
    await stalling(socketPathFor(r.worktreeId), (type) => (type === "ping" ? {} : pending));
    const result = await timed(["run", "lint", "--wait", "300"], r.root);
    expect(result).toMatchObject({ code: 3, stderr: "", inTime: true });
    expect(result.stdout).toMatch(
      /^Group lint has no verdict: the deadline passed before the daemon took request g1; the daemon's main thread has sent no heartbeat for 1 min 5\d s\. The request stays pending: /,
    );
  });

  // Review 0.1.409 B1: a store no one can read drops only the heartbeat detail.
  it("has no verdict, in time and naming the holder, while the store is locked", async () => {
    const r = repo();
    r.daemon("stale", Date.now() - 111_000);
    const holder = {
      kind: "scheduler",
      operation: "applying revision 412",
      heldMs: 48_400,
      step: null,
    };
    const pending = { ...requested(0), requested: null, holder };
    await stalling(socketPathFor(r.worktreeId), (type) => {
      // An exclusive lock on a WAL store needs every other connection closed.
      if (type === "run-group") {
        r.mainStore.close();
        lockStore(r.repo.commonDir);
      }
      return type === "ping" ? {} : pending;
    });
    expect(await timed(["run", "lint", "--wait", "300"], r.root)).toEqual({
      code: 3,
      stdout: `Group lint has no verdict: the deadline passed before the daemon took request g1; it waits for the scheduler, which has been applying revision 412 for 48 s. ${STAYS}\n`,
      stderr: "",
      inTime: true,
    });
  });
});

const STAYS =
  "The request stays pending: wait again with squeal run lint --wait, or run the linter yourself.";
