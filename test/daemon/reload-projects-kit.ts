import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { retryCommand } from "../../src/cli/retry.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { KnownState, Store, TestFileKeyRecord } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { runMissingConfig } from "../helpers/baseline.js";
import { childEnv, delay, type FixtureRepo, readNotes, withStore } from "./helpers.js";

/*
 * A real daemon, in this process, over a committed repository under /tmp
 * where `vitest` does not resolve, holding node:test projects only (row
 * 011-78, `tasks/011-62/design.md` R1, as its probe `probes/run.sh`). Each
 * test file appends its name to a log outside the worktree when it runs.
 */

/**
 * What a test of the fixture does after it logs its run: fail, assert the
 * env's `MODE`, and while the repository's hold exists, log `<name>
 * started`, sleep and log `<name> done`. Default: pass at once.
 */
export interface Body {
  readonly fail?: boolean;
  readonly mode?: string;
  readonly heldMs?: number;
}

/** A `nodeTest` entry as `squeal.config.json` holds it. */
export interface Entry {
  readonly name: string;
  readonly cwd: string;
  readonly include?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly slow?: boolean;
}

export interface ReloadRepo extends FixtureRepo {
  /** Writes `squeal.config.json` with these `nodeTest` entries, each including `*.test.mjs` by default. */
  config(entries: readonly Entry[]): void;
  /** Writes a test file at `path` (worktree-relative) whose test logs `name` and does `body`. */
  test(path: string, name: string, body?: Body): void;
  /** Creates or removes the hold a `heldMs` body sleeps under. */
  hold(on: boolean): void;
  write(path: string, content: string): void;
  /** How often the test logged as `name` ran, and whether `marker` was logged. */
  runs(name: string): number;
  logged(marker: string): boolean;
  rows(): TestFileKeyRecord[];
  row(path: string): TestFileKeyRecord | undefined;
  states(project?: string): KnownState[];
  notes(): string[];
  store<T>(fn: (store: Store) => T): T;
  /** Until a `squeal status --wait` returns quiet: every edit before it refined and run. */
  settle(): Promise<void>;
  /** Until every listed file has a key and nothing is pending. */
  ran(label: string, files?: number): Promise<void>;
  /** Until `check` holds, read every 100 ms for up to two minutes. */
  until(label: string, check: () => boolean): Promise<void>;
  /** `squeal retry <path>` from the root: its exit code and output. */
  retry(path: string): Promise<{ code: number; stdout: string }>;
}

const program = (log: string, hold: string, name: string, body: Body): string => {
  const line = (text: string) =>
    `appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${text}\n`)});`;
  const steps = [
    line(name),
    ...(body.heldMs === undefined
      ? []
      : [
          `if (existsSync(${JSON.stringify(hold)})) {`,
          `  ${line(`${name} started`)}`,
          `  await new Promise((resolve) => setTimeout(resolve, ${body.heldMs}));`,
          `  ${line(`${name} done`)}`,
          "}",
        ]),
    ...(body.mode === undefined
      ? []
      : [`assert.equal(process.env.MODE, ${JSON.stringify(body.mode)});`]),
    ...(body.fail === true ? ['assert.fail("removed or renamed project still ran");'] : []),
  ];
  return `import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";
import { test } from "node:test";

test(${JSON.stringify(`${name} runs`)}, async () => {
${steps.map((step) => `  ${step}`).join("\n")}
});
`;
};

/**
 * A committed repository with `entries` and their files, and a daemon
 * serving it once `ready`. Each config it writes holds `more`'s keys too.
 */
export async function reloadRepo(
  entries: readonly Entry[],
  files: Readonly<Record<string, { readonly name: string; readonly body?: Body }>>,
  more: Readonly<Record<string, unknown>> = {},
): Promise<ReloadRepo> {
  const root = realpathSync(mkdtempSync("/tmp/sq-reload-"));
  const runtimeDir = realpathSync(mkdtempSync("/tmp/sq-"));
  const log = join(runtimeDir, "runs.log");
  const hold = join(runtimeDir, "hold");
  writeFileSync(log, "");
  const worktreeId = worktreeIdFor(root);
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const config = (list: readonly Entry[]) =>
    write(
      "squeal.config.json",
      runMissingConfig(
        JSON.stringify({ ...more, nodeTest: list.map((e) => ({ include: ["*.test.mjs"], ...e })) }),
      ),
    );
  const test = (path: string, name: string, body: Body = {}) =>
    write(path, program(log, hold, name, body));
  write("package.json", '{ "private": true, "type": "module" }\n');
  config(entries);
  for (const [path, { name, body }] of Object.entries(files)) test(path, name, body);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "fixture"]);
  const repo: FixtureRepo = {
    root,
    commonDir: join(root, ".git"),
    worktreeId,
    runtimeDir,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: runtimeDir }),
    env: childEnv(runtimeDir),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
  onTestFinished(repo.cleanup);
  const daemon = await startDaemon({ root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  onTestFinished(async () => {
    await daemon.stop("stop-requested");
  });
  await daemon.ready;

  const lines = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n") : []);
  const store = <T>(fn: (store: Store) => T): T => withStore(repo, fn);
  const rows = () => store((s) => [...s.testFileKeys.list(worktreeId)]);
  const until = async (label: string, check: () => boolean) => {
    const deadline = Date.now() + 120_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`${label}: not met in 120 s`);
      await delay(100);
    }
  };
  return {
    ...repo,
    config,
    test,
    hold: (on) => (on ? writeFileSync(hold, "") : rmSync(hold, { force: true })),
    write,
    runs: (name) => lines().filter((line) => line === name).length,
    logged: (marker) => lines().includes(marker),
    rows,
    row: (path) => rows().find((row) => row.testFile.path === path),
    states: (project) =>
      store((s) =>
        s.knownStates
          .list(worktreeId)
          .filter((x) => project === undefined || x.check.project === project),
      ),
    notes: () => readNotes(repo),
    store,
    async settle() {
      for (let i = 0; i < 10; i++) {
        const wait = await waitForStatus(root, { timeoutMs: 60_000 });
        if (wait.outcome === "quiet") return;
      }
      throw new Error("status --wait never returned quiet");
    },
    ran: (label, files) =>
      until(label, () => {
        const all = rows();
        return (
          (files === undefined || all.length === files) &&
          all.every((row) => row.key !== null && row.pending === null)
        );
      }),
    until,
    async retry(path) {
      let stdout = "";
      const io: CliIo = {
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stdout += text;
        },
        cwd: root,
        env: { CLAUDE_CODE_SESSION_ID: "reload-1" },
      };
      const code = await retryCommand([path, "--reason", "environment"], io, {
        hostLoad: () => ({ oneMinute: 1, cpus: 8 }),
      });
      return { code, stdout };
    },
  };
}

/** Appends a comment to `path`, an edit of its bytes. */
export function touch(repo: Pick<FixtureRepo, "root">, path: string): void {
  appendFileSync(join(repo.root, path), "// edited\n");
}
