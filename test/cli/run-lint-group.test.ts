import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { release } from "../../src/core/lint/pass/commit-entry.js";
import { lintScope } from "../../src/core/lint/pass/records.js";
import { isLintStoreOpenFailure, openLintStore } from "../../src/core/lint/store/index.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import type { LintOutcome } from "../../src/core/types/lint.js";
import { squealRepo } from "../harness/helpers.js";
import { clientGone, closeFakeDaemons, fakeDaemon, received } from "./fake-daemon.js";

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
  for (const server of servers.splice(0)) server.close();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A repository whose lint group `lint` is at `commit`, with its lint store's states. */
function repo(states: Record<string, LintOutcome> = {}) {
  const r = squealRepo();
  writeFileSync(
    join(r.root, "squeal.config.json"),
    JSON.stringify({
      lint: { enabled: true, tools: ["eslint"] },
      checks: [{ name: "lint", lint: true, at: "commit" }],
    }),
  );
  const lint = { ...DEFAULT_POLICY.lint, enabled: true };
  const store = openLintStore(r.repo.commonDir, { lint }, { busyTimeoutMs: 5_000 });
  if (isLintStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  const write = (path: string, outcome: LintOutcome) =>
    store.states.upsertMany([
      {
        worktreeId: r.worktreeId,
        check: { kind: "lint", path, tool: "eslint" },
        outcome,
        judged: null,
        stale: false,
        reason: null,
        changedAt: 1,
      },
    ]);
  for (const [path, outcome] of Object.entries(states)) write(path, outcome);
  const scope = lintScope(r.worktreeId, "eslint");
  return {
    ...r,
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

  it("with no daemon, or one that does not answer, has no verdict within the wait", async () => {
    const r = repo();
    expect(await run(["run", "lint", "--wait", "1000"], r.root)).toMatchObject({
      code: 3,
      stdout: "Group lint has no verdict: no daemon is running; start one with squeal start\n",
    });
    expect((await run(["run", "lint"], r.root)).code).toBe(1);

    // A daemon that answers its ping but never `run-group`.
    const server = createServer((socket) => {
      socket.on("error", clientGone);
      socket.once("data", (data) => {
        const { type } = JSON.parse(data.toString()) as { type: string };
        if (type === "ping")
          socket.end(`${JSON.stringify({ schemaVersion: 1, ok: true, type })}\n`);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(socketPathFor(r.worktreeId), resolve));
    const started = Date.now();
    const stalled = await run(["run", "lint", "--wait", "300"], r.root);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(stalled.code).toBe(3);
    expect(stalled.stdout).toMatch(/^Group lint has no verdict: the daemon did not answer/);
    expect(stalled.stderr).toBe("");
  });
});
