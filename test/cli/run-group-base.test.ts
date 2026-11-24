import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { NarrowRun } from "../../src/core/types/scheduler.js";
import { appendRevisions, check, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon, received } from "./fake-daemon.js";

/*
 * Row 026-07 (spec 026 D4): `squeal run <group> --base <ref>` sends the
 * paths changed since the merge base (branch commits, staged, unstaged,
 * untracked) as a narrow run for a test group, lints a lint group's pending
 * checks, and says what it left for `squeal run <group>` or CI; against a
 * real git repository and a stand-in daemon.
 */

const UNIT = "test/unit/core.test.ts";
const ref = (path: string) => ({ project: "", path: path as never });
const fileCheck = (path: string): CheckId => ({ kind: "file", project: "", testPath: path });

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.CODEX_SESSION_ID;
  delete process.env.PI_SESSION_ID;
  delete process.env.OPENCODE_SESSION_ID;
  delete process.env.ANTIGRAVITY_CONVERSATION_ID;
});
afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * A git worktree at revision 3 on branch `feature` off `main`: `unit` at
 * `manual`, `lint` at `commit`; its daemon on `socket`. The branch commits
 * `src/core.ts` and removes `src/gone.ts`; `src/staged.ts` is staged,
 * `src/edited.ts` edited, `src/new.ts` untracked and `build/out.js`
 * ignored.
 */
function worktree() {
  const repo = fakeRepo();
  const root = repo.main;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      stdio: "pipe",
    }).toString();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  git("init", "-q", "-b", "main");
  write(
    "squeal.config.json",
    JSON.stringify({
      checks: [
        { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "manual" },
        { name: "lint", lint: true, at: "commit" },
      ],
    }),
  );
  write(".gitignore", "build/\n");
  for (const path of ["src/core.ts", "src/gone.ts", "src/edited.ts", UNIT]) write(path, "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  write("src/core.ts", "2\n");
  unlinkSync(join(root, "src/gone.ts"));
  git("add", "-A");
  git("commit", "-q", "-m", "branch");
  write("src/staged.ts", "1\n");
  git("add", "src/staged.ts");
  write("src/edited.ts", "2\n");
  write("src/new.ts", "1\n");
  write("build/out.js", "1\n");
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, id, 3, { head: null, dirty: true });
  const socket = join(runtimeDir, "daemon.sock");
  store.worktrees.setDaemon(id, {
    socketPath: socket,
    startedAt: Date.now(),
    heartbeatAt: Date.now(),
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
  });
  /** `path` listed and current, its test passing. */
  const current = (path: string) => {
    const key = `key-${path}` as CheckKey;
    const row = { worktreeId: id, testFile: ref(path), key, revision: 3 as RevisionNumber };
    store.testFileKeys.upsertMany([{ ...row, pending: null }]);
    store.knownStates.upsertMany([
      state(id, check(path, "works"), { validity: "current", outcome: "pass", observedAt: 3 }),
      state(id, fileCheck(path), { validity: "current", outcome: "pass", observedAt: 3 }),
    ]);
  };
  const base = git("merge-base", "main", "HEAD").trim();
  return { root, socket, git, current, base };
}

const CHANGED = [
  "src/core.ts",
  "src/edited.ts",
  "src/gone.ts",
  "src/new.ts",
  "src/staged.ts",
] as const;

const NARROW: NarrowRun = {
  selected: [ref(UNIT)],
  reached: 4,
  others: [],
  unmatched: ["src/gone.ts", "src/new.ts"],
  current: 0,
  notRun: [],
};

/** A daemon that takes `run-group-paths` for `unit` at revision 3 with `narrow`. */
function daemon(socket: string, queued: number, narrow: Partial<NarrowRun> = {}) {
  const taken = {
    ok: true,
    type: "run-group",
    requestId: "g1",
    group: "unit",
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
  return { code, stdout, stderr, lines: stdout.split("\n") };
}

const sent = () => received.filter((request) => request.type !== "ping");

describe("squeal run <group> --base <ref> (spec 026 D4, row 026-07)", () => {
  it("sends the branch's, staged, unstaged and untracked paths as a narrow run", async () => {
    const w = worktree();
    await daemon(w.socket, 1);
    const result = await run(["run", "unit", "--base", "main"], join(w.root, "src"));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(sent()).toEqual([{ type: "run-group-paths", group: "unit", paths: [...CHANGED] }]);
    expect(result.stdout).toBe(
      [
        `Changes since ${w.base.slice(0, 12)} (merge base of main and HEAD): 5 changed paths.`,
        "Group unit at revision 3: these paths select 1 test file; 1 queued, which run now.",
        "4 other test files of group unit read these paths; they wait for `squeal run unit` or CI; this narrow run did not run them.",
        "src/gone.ts, src/new.ts select no test file of any group.",
        "",
      ].join("\n"),
    );
  });

  it("--json names the merge base, the selection, the omitted files and the unmatched paths", async () => {
    const w = worktree();
    await daemon(w.socket, 1);
    const result = await run(["run", "unit", "--base", "main", "--json"], w.root);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      group: "unit",
      kind: "test",
      ref: "main",
      mergeBase: w.base,
      changedPaths: [...CHANGED],
      wholeGroup: false,
      revision: 3,
      selected: [{ path: UNIT, project: "", state: null }],
      current: 0,
      queued: 1,
      omitted: 4,
      others: [],
      unmatched: ["src/gone.ts", "src/new.ts"],
      verdict: null,
      code: 0,
      note: "4 other test files of group unit read these paths and were not run here; they wait for `squeal run unit` or CI.",
    });
  });

  it("reuses a current selected file: none runs again, and --wait gives its verdict", async () => {
    const w = worktree();
    w.current(UNIT);
    await daemon(w.socket, 0, { current: 1, reached: 0, unmatched: [] });
    const text = await run(["run", "unit", "--base", "main", "--wait", "20000"], w.root);
    expect(text.lines[0]).toBe(
      "Selected test files of group unit completed at revision 3: no known failures; 1 test file, 0 queued by this request",
    );
    expect(text.lines[1]).toBe(
      `Changes since ${w.base.slice(0, 12)} (merge base of main and HEAD): 5 changed paths.`,
    );
    expect(text.lines[2]).toBe(
      "Group unit at revision 3: these paths select 1 test file, current; none runs again.",
    );
    expect(text.stdout).not.toContain("all tests passed");
    expect(text.code).toBe(0);
    const json = await run(["run", "unit", "--base", "main", "--wait", "20000", "--json"], w.root);
    const answer = JSON.parse(json.stdout);
    expect(answer.verdict).toEqual({
      line: "Selected test files of group unit completed at revision 3: no known failures; 1 test file, 0 queued by this request",
      code: 0,
    });
    expect(answer.selected).toEqual([{ path: UNIT, project: "", state: null, failed: false }]);
    expect(answer.wholeGroup).toBe(false);
    expect(answer.note).toBe(
      "A narrow run: group unit is not current as a whole; `squeal run unit` or CI runs it.",
    );
    expect(json.code).toBe(0);
  });

  it("names a selected file that does not run, by its reason", async () => {
    const w = worktree();
    const notRun = [{ testFile: ref(UNIT), reason: "its runner failed" }];
    await daemon(w.socket, 0, { notRun, reached: 0, unmatched: [] });
    const result = await run(["run", "unit", "--base", "main", "--json"], w.root);
    expect(JSON.parse(result.stdout).selected).toEqual([
      { path: UNIT, project: "", state: "not-run", reason: "its runner failed" },
    ]);
  });

  it("lints a lint group's pending checks and names the changed paths", async () => {
    const w = worktree();
    const taken = {
      ok: true,
      type: "run-group",
      requestId: "g1",
      group: "lint",
      requested: { revision: 3, queued: 2 },
      unknown: false,
      error: null,
    };
    await fakeDaemon(w.socket, { "run-group": [taken] });
    const text = await run(["run", "lint", "--base", "main"], w.root);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      [
        `Changes since ${w.base.slice(0, 12)} (merge base of main and HEAD): 5 changed paths; group lint lints its pending lint checks, these among them.`,
        "Group lint requested at revision 3: 2 lint checks queued; they lint now.",
        "",
      ].join("\n"),
    );
    expect(sent()).toEqual([{ type: "run-group", group: "lint" }]);
    const json = await run(["run", "lint", "--base", "main", "--json"], w.root);
    expect(JSON.parse(json.stdout)).toMatchObject({
      group: "lint",
      kind: "lint",
      mergeBase: w.base,
      changedPaths: [...CHANGED],
      revision: 3,
      queued: 2,
      verdict: null,
      code: 0,
    });
  });

  it("says nothing changed and asks no daemon", async () => {
    const w = worktree();
    w.git("add", "-A");
    w.git("commit", "-q", "-m", "rest");
    const result = await run(["run", "unit", "--base", "HEAD"], w.root);
    const head = w.git("rev-parse", "HEAD").trim();
    expect(result.stdout).toBe(
      `Changes since ${head.slice(0, 12)} (merge base of HEAD and HEAD): 0 changed paths: nothing to run.\n`,
    );
    expect(result.code).toBe(0);
    expect(sent()).toEqual([]);
  });

  it("rejects an unknown ref, --base with paths and --json without --base (exit 2)", async () => {
    const w = worktree();
    const bad = await run(["run", "unit", "--base", "nope"], w.root);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/^squeal run: --base nope: "nope" names no commit\n/);
    const paths = await run(["run", "unit", "src/core.ts", "--base", "main"], w.root);
    expect(paths.code).toBe(2);
    expect(paths.stderr).toMatch(/^squeal run: --base takes no paths: squeal run unit --base main/);
    const json = await run(["run", "unit", "--json"], w.root);
    expect(json.code).toBe(2);
    expect(json.stderr).toMatch(/^squeal run: --json needs --base <ref>/);
    const bare = await run(["run", "unit", "--base"], w.root);
    expect(bare.code).toBe(2);
    expect(bare.stderr).toMatch(/^squeal run: --base needs a ref/);
    expect(sent()).toEqual([]);
  });
});
