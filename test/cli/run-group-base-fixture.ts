import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { type CoveredFile, writeCoveredFiles } from "../../src/core/store/covered-files.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { NarrowRun } from "../../src/core/types/scheduler.js";
import { appendRevisions, fakeRepo, seedStore, state } from "../status/helpers.js";
import { closeFakeDaemons, fakeDaemon, received } from "./fake-daemon.js";

/*
 * Row 026-07 (spec 026 D4): the worktree, stand-in daemon and command run
 * that the `squeal run <group> --base <ref>` tests share.
 */

export const UNIT = "test/unit/core.test.ts";
export const ref = (path: string, project = "") => ({ project, path: path as never });

/** Run once per test file: a runtime dir and a git environment of its own. */
export function useBaseEnv(): () => string {
  const saved = { ...process.env };
  let runtimeDir = "";
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
  return () => runtimeDir;
}

/**
 * A git worktree at revision 3 on branch `feature` off `main`: `unit` at
 * `manual`, `lint` at `commit`; its daemon on `socket`. The branch commits
 * `src/core.ts` and removes `src/gone.ts`; `src/staged.ts` is staged,
 * `src/edited.ts` edited, `src/new.ts` untracked and `build/out.js`
 * ignored.
 */
export function worktree(runtimeDir: string) {
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
  /** `path` of `project` listed and current, its test passing, or failing with `outcome`. */
  const current = (path: string, project = "", outcome: "pass" | "fail" = "pass") => {
    const key = `key-${project}-${path}` as CheckKey;
    const row = {
      worktreeId: id,
      testFile: ref(path, project),
      key,
      revision: 3 as RevisionNumber,
    };
    store.testFileKeys.upsertMany([{ ...row, pending: null }]);
    const test = { kind: "test", project, testPath: path, fullName: "works" } as const;
    const file = { kind: "file", project, testPath: path } as const;
    const observed = { validity: "current", outcome, observedAt: 3 } as const;
    store.knownStates.upsertMany([state(id, test, observed), state(id, file, observed)]);
  };
  /** `path` of `project` listed and queued at its key, with no result yet. */
  const queued = (path: string, project = "") => {
    const key = `key-${project}-${path}` as CheckKey;
    const pending = "queued" as const;
    store.testFileKeys.upsertMany([
      { worktreeId: id, testFile: ref(path, project), key, revision: 3 as RevisionNumber, pending },
    ]);
  };
  /** The request's record of its covered files, under `coveredId`. */
  const covered = (coveredId: string, files: CoveredFile[]) =>
    writeCoveredFiles(
      store,
      {
        id: coveredId,
        worktreeId: id,
        revision: 3 as RevisionNumber,
        recordedAt: Date.now() as EpochMs,
        files,
      },
      { listed: () => true, pending: () => false, leftAt: () => null, knownSince: 0 as EpochMs },
    );
  const base = git("merge-base", "main", "HEAD").trim();
  return { root, socket, git, write, current, queued, covered, base, store, id };
}

export const CHANGED = [
  "src/core.ts",
  "src/edited.ts",
  "src/gone.ts",
  "src/new.ts",
  "src/staged.ts",
] as const;

export const NARROW: NarrowRun = {
  selected: [ref(UNIT)],
  reached: 4,
  others: [],
  unmatched: ["src/gone.ts", "src/new.ts"],
  current: 0,
  notRun: [],
};

/** A daemon that takes `run-group-paths` for `unit` at revision 3 with `narrow`. */
export function daemon(
  socket: string,
  queued: number,
  narrow: Partial<NarrowRun> = {},
  coveredId?: string,
) {
  const taken = {
    ok: true,
    type: "run-group",
    requestId: "g1",
    group: "unit",
    requested: { revision: 3, queued, ...(coveredId === undefined ? {} : { coveredId }) },
    unknown: false,
    error: null,
    narrow: { ...NARROW, ...narrow },
  };
  return fakeDaemon(socket, { "run-group-paths": [taken] });
}

export async function run(argv: string[], cwd: string) {
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

export const sent = () => received.filter((request) => request.type !== "ping");
