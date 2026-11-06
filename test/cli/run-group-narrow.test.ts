import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { NARROW_NOT_SUPPORTED } from "../../src/core/daemon/run-group.js";
import type {
  CheckId,
  CheckKey,
  KnownOutcome,
  NarrowRun,
  PendingPhase,
  RevisionNumber,
  Validity,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon, received } from "./fake-daemon.js";

/*
 * Row 019-49 (spec 019 D6, "Narrow run"): `squeal run <group> <path>...`
 * sends `run-group-paths`, prints what the paths select and leave, and with
 * `--wait` gives the verdict of the selected files only, against a
 * stand-in daemon. A daemon before narrow runs refuses the request type and
 * runs nothing; the CLI says it predates them.
 */

const E2E = "test/e2e/a.test.ts";
const E2E_B = "test/e2e/b.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const fileCheck = (path: string): CheckId => ({ kind: "file", project: "", testPath: path });

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A worktree at revision 3: `e2e` at `stop`, `unit` at `edit`, `lint` at `stop`; its daemon on `socket`. */
function worktree() {
  const repo = fakeRepo();
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({
      checks: [
        { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" },
        { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "edit" },
        { name: "lint", lint: true, at: "stop" },
      ],
    }),
  );
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: false });
  const socket = join(runtimeDir, "daemon.sock");
  store.worktrees.setDaemon(id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  /** `path` listed, with a test and its file-level check. */
  const file = (
    path: string,
    {
      validity = "current",
      outcome = "pass",
      pending = null,
    }: { validity?: Validity; outcome?: KnownOutcome; pending?: PendingPhase | null } = {},
  ) => {
    const key = `key-${path}` as CheckKey;
    const row = { worktreeId: id, testFile: ref(path), key, revision: 3 as RevisionNumber };
    store.testFileKeys.upsertMany([{ ...row, pending }]);
    const pendingPhase = validity === "pending" ? ("queued" as const) : null;
    store.knownStates.upsertMany([
      state(id, check(path, "works"), { validity, outcome, pendingPhase, observedAt: 3 }),
      state(id, fileCheck(path), { validity, outcome: "pass", pendingPhase, observedAt: 3 }),
    ]);
  };
  return { root: repo.main, socket, file };
}

const NARROW: NarrowRun = {
  selected: [ref(E2E)],
  reached: 1,
  others: [{ group: "unit", files: 2, paths: ["src/core.ts"] }],
  unmatched: [],
};

/** A daemon that takes `run-group-paths` for `e2e` at revision 3 with `narrow`, and answers pings. */
function daemon(socket: string, queued: number, narrow: Partial<NarrowRun> = {}) {
  const taken = {
    ok: true,
    type: "run-group",
    requestId: "g1",
    group: "e2e",
    requested: { revision: 3, queued },
    unknown: false,
    error: null,
    narrow: { ...NARROW, ...narrow },
  };
  return fakeDaemon(socket, { "run-group-paths": [taken] });
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
  const lines = stdout.split("\n");
  return { code, stdout, stderr, lines };
}

const sent = () => received.filter((request) => request.type !== "ping");
const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

describe("squeal run <group> <path>... (spec 019 D6, row 019-49)", () => {
  it("sends run-group-paths with root-relative paths and names what the paths leave", async () => {
    const w = worktree();
    mkdirSync(join(w.root, "src"), { recursive: true });
    await daemon(w.socket, 1, { unmatched: ["src/none.ts"] });
    const result = await run(["run", "e2e", "core.ts", "../src/none.ts"], join(w.root, "src"));
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "Group e2e at revision 3: these paths select 1 test file; 1 queued, which run now.",
        "1 other test file of group e2e reads these paths; it waits for a pause or `squeal run e2e`.",
        "Group unit has 2 test files these paths select: `squeal run unit src/core.ts` runs them.",
        "src/none.ts selects no test file of any group.",
        "",
      ].join("\n"),
    );
    expect(sent()).toEqual([
      { type: "run-group-paths", group: "e2e", paths: ["src/core.ts", "src/none.ts"] },
    ]);
  });

  it("--wait gives the selected files' verdict while the group's other file stays pending", async () => {
    const w = worktree();
    w.file(E2E, { validity: "pending", pending: "queued" });
    w.file(E2E_B, { validity: "pending", pending: "queued" });
    await daemon(w.socket, 1);
    later(300, () => w.file(E2E));
    const result = await run(["run", "e2e", "src/core.ts", "--wait", "20000"], w.root);
    expect(result.lines[0]).toBe(
      "Selected test files of group e2e completed at revision 3: no known failures; 1 test file, 1 queued by this request",
    );
    expect(result.lines[1]).toBe(
      "Group e2e at revision 3: these paths select 1 test file; 1 queued, which run now.",
    );
    expect(result.code).toBe(0);
  });

  it("--wait exits 1 with a failure among them, and 3 when a path selects nothing", async () => {
    const w = worktree();
    w.file(E2E, { outcome: "fail" });
    await daemon(w.socket, 0, { unmatched: ["src/none.ts"] });
    const failed = await run(["run", "e2e", E2E, "src/none.ts", "--wait", "5000"], w.root);
    expect(failed.lines[0]).toBe(
      "Selected test files of group e2e completed at revision 3: 1 known failure: 1 test; 1 test file, 0 queued by this request; src/none.ts selects no test file of any group",
    );
    expect(failed.lines[1]).toBe(
      "Group e2e at revision 3: these paths select 1 test file, current; none runs again.",
    );
    expect(failed.code).toBe(1);
    w.file(E2E);
    const passed = await run(["run", "e2e", E2E, "src/none.ts", "--wait", "5000"], w.root);
    expect(passed.lines[0]).toBe(
      "Selected test files of group e2e have no verdict: src/none.ts selects no test file of any group",
    );
    expect(passed.code).toBe(3);
  });

  it("--wait exits 3 at once when the paths select no file of the group", async () => {
    const w = worktree();
    await daemon(w.socket, 0, { selected: [], reached: 0 });
    const result = await run(["run", "e2e", "src/core.ts", "--wait", "20000"], w.root);
    expect(result.lines.slice(0, 2)).toEqual([
      "Selected test files of group e2e have no verdict: these paths select none",
      "Group e2e at revision 3: these paths select no test file of it.",
    ]);
    expect(result.code).toBe(3);
  });

  it("exits 2 for a lint group with paths, naming its whole run, and asks no daemon", async () => {
    const w = worktree();
    const result = await run(["run", "lint", "src/core.ts"], w.root);
    expect(result.code).toBe(2);
    expect(result.stderr.split("\n")[0]).toBe(
      "squeal run: group lint is a lint group, which takes no paths: squeal run lint",
    );
    expect(result.stderr).toContain("squeal run <group> [<path>...] [--wait [<ms>]]");
    expect(sent()).toEqual([]);
  });

  it("exits 2 for a path outside the worktree", async () => {
    const w = worktree();
    const result = await run(["run", "e2e", "/elsewhere/x.ts"], w.root);
    expect(result.code).toBe(2);
    expect(result.stderr.split("\n")[0]).toBe(
      `squeal run: "/elsewhere/x.ts" is not inside the worktree ${w.root}`,
    );
    expect(sent()).toEqual([]);
  });

  it("says an older daemon predates narrow runs and ran nothing, exiting as for groups", async () => {
    const w = worktree();
    await fakeDaemon(w.socket, {
      "run-group-paths": [{ ok: false, error: 'unknown request type "run-group-paths"' }],
    });
    expect(await run(["run", "e2e", "src/core.ts"], w.root)).toMatchObject({
      code: 1,
      stdout: "",
      stderr: `squeal: ${NARROW_NOT_SUPPORTED}\n`,
    });
    const waited = await run(["run", "e2e", "src/core.ts", "--wait", "500"], w.root);
    expect(waited).toMatchObject({ code: 3, stdout: `No verdict: ${NARROW_NOT_SUPPORTED}\n` });
    // It never falls back to the whole group's request.
    expect(sent().map((request) => request.type)).toEqual(["run-group-paths", "run-group-paths"]);
  });

  it("reads an answer without a selection as no narrow run", async () => {
    const w = worktree();
    const whole = {
      ok: true,
      type: "run-group",
      requestId: "g1",
      group: "e2e",
      requested: { revision: 3, queued: 2 },
      unknown: false,
      error: null,
    };
    await fakeDaemon(w.socket, { "run-group-paths": [whole] });
    expect(await run(["run", "e2e", "src/core.ts"], w.root)).toMatchObject({
      code: 1,
      stderr: `squeal: ${NARROW_NOT_SUPPORTED}\n`,
    });
  });
});
