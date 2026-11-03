import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type {
  CheckId,
  CheckKey,
  KnownOutcome,
  PendingPhase,
  RevisionNumber,
  Validity,
} from "../../src/core/types/index.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Spec 019 D6, row 019-15: `squeal run <group> --wait` gives the group's
 * verdict, 0, 1 or 3, from its own test files, whatever the group's moment,
 * against a stand-in daemon.
 */

const E2E = "test/e2e/a.test.ts";
const E2E_B = "test/e2e/b.test.ts";
const UNIT = "test/unit/u.test.ts";
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

/** A worktree at revision 3 with an `e2e` group at `stop` and `unit` at `edit`, its daemon on `socket`. */
function worktree() {
  const repo = fakeRepo();
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({
      checks: [
        { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" },
        { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "edit" },
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
  return { root: repo.main, store, socket, file };
}

/** A daemon that takes `run-group` for `group` at revision 3, `queued` files, and answers pings. */
function daemon(socket: string, group: string, queued: number) {
  const taken = {
    ok: true,
    type: "run-group",
    requestId: "g1",
    group,
    requested: { revision: 3, queued },
    unknown: false,
    error: null,
  };
  return fakeDaemon(socket, { "run-group": [taken] });
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd,
  };
  const code = await main(argv, io);
  const [first, second] = stdout.split("\n");
  return { code, stdout, first, second };
}

const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

describe("squeal run <group> --wait: the group's verdict (spec 019 D6)", () => {
  it("exits 0 once the group's files are current, whatever another group has pending", async () => {
    const w = worktree();
    w.file(E2E, { validity: "pending", pending: "queued" });
    w.file(E2E_B);
    w.file(UNIT, { validity: "pending", pending: "queued" });
    await daemon(w.socket, "e2e", 1);
    later(300, () => w.file(E2E));
    const result = await run(["run", "e2e", "--wait"], w.root);
    expect(result.first).toBe(
      "Group e2e completed at revision 3: no known failures; 2 test files, 1 queued by this request",
    );
    expect(result.second).toBe(
      "Group e2e requested at revision 3: 1 test file queued; they run now.",
    );
    expect(result.stdout).toContain("\n\nRevision: 3");
    expect(result.code).toBe(0);
  });

  it("exits 1 with a known failure among the group's files", async () => {
    const w = worktree();
    w.file(E2E, { validity: "pending", pending: "queued" });
    w.file(UNIT, { outcome: "fail" });
    await daemon(w.socket, "e2e", 1);
    later(200, () => w.file(E2E, { outcome: "fail" }));
    const result = await run(["run", "e2e", "--wait", "20000"], w.root);
    expect(result.first).toBe(
      "Group e2e completed at revision 3: 1 known failure: 1 test; 1 test file, 1 queued by this request",
    );
    expect(result.code).toBe(1);
  });

  it("exits 3 at the deadline with a file of the group pending", async () => {
    const w = worktree();
    w.file(E2E, { validity: "pending", pending: "queued" });
    await daemon(w.socket, "e2e", 1);
    const result = await run(["run", "e2e", "--wait", "1500"], w.root);
    expect(result.first).toBe(
      "Group e2e has no verdict: the deadline passed with 1 test file pending at revision 3; the group goes on in the daemon",
    );
    expect(result.code).toBe(3);
  });

  it("exits 3 when a file of the group has no current result and nothing runs it", async () => {
    const w = worktree();
    w.file(E2E, { validity: "stale" });
    w.file(E2E_B);
    await daemon(w.socket, "e2e", 0);
    const result = await run(["run", "e2e", "--wait", "5000"], w.root);
    expect(result.first).toBe(
      "Group e2e has no verdict: 1 test file without a current result at revision 3 (1 stale)",
    );
    expect(result.second).toBe(
      "No test files of group e2e to run at revision 3: the group has none or all are current.",
    );
    expect(result.code).toBe(3);
  });

  it("exits 3 for a group with no listed test files", async () => {
    const w = worktree();
    w.file(UNIT);
    await daemon(w.socket, "e2e", 0);
    const result = await run(["run", "e2e", "--wait", "5000"], w.root);
    expect(result.first).toBe(
      "Group e2e has no verdict: the group has no listed test files at revision 3",
    );
    expect(result.code).toBe(3);
  });

  it("exits 3 when the daemon goes away before the group's files have results", async () => {
    const w = worktree();
    w.file(E2E, { validity: "pending", pending: "queued" });
    await daemon(w.socket, "e2e", 1);
    // The stand-in answers `run-group`, then nothing listens: the wait's ping finds no daemon.
    later(200, () => closeFakeDaemons());
    const result = await run(["run", "e2e", "--wait", "20000"], w.root);
    expect(result.first).toBe(
      "Group e2e has no verdict: the daemon stopped before the group's test files had results",
    );
    expect(result.code).toBe(3);
  });
});
