import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/*
 * Review of 0.1.443-r2 S2 (spec 020 D19.6): a test worker watches
 * `node:inspector` only when its Vitest process said a coverage provider
 * runs. Review of 0.1.444 B3: the Vitest process says so in a file below the
 * run's raw directory (`watchWorkers`), never in its environment, so no
 * allow-listed variable, key or part descriptor changes. Review of 0.1.444
 * S1: the Vitest CLI process itself installs no watch. Each case runs in
 * Node processes of its own, as the watch changes their globals.
 */

const RUNTIME = resolve(import.meta.dirname, "../../../src/runners/vitest/ci-runtime");
const INSPECTOR = join(RUNTIME, "inspector.cjs");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "squeal-inspector-watch-"));
  dirs.push(dir);
  return dir;
}

/** `node <args>` with this process's env less the recording's, plus `env`; its JSON output. */
function node(args: readonly string[], env: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  const { SQUEAL_CI_RECORD: _record, ...base } = process.env;
  const out = execFileSync(process.execPath, args, { env: { ...base, ...env }, encoding: "utf8" });
  return JSON.parse(out) as Record<string, unknown>;
}

/** Each line the watch logged below `raw`, sorted; `null` when it wrote no log. */
function logs(raw: string): unknown[] | null {
  const dir = join(raw, "inspector");
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".ndjson")) : [];
  if (names.length === 0) return null;
  const lines = names.flatMap((n) => readFileSync(join(dir, n), "utf8").trim().split("\n"));
  return lines.sort().map((line) => JSON.parse(line));
}

/** A worker: installs the watch, then loads the inspector while `file` runs; `report`s its hook state. */
const worker = (raw: string, file: string, report: string) =>
  [
    `const watch = require(${JSON.stringify(INSPECTOR)});`,
    "const builtin = process.getBuiltinModule;",
    `watch.installWatch(${JSON.stringify(raw)}, undefined);`,
    `globalThis.__vitest_worker__ = { filepath: ${JSON.stringify(file)}, ctx: { projectName: "" } };`,
    'process.getBuiltinModule("node:inspector");',
    `(${report})({ flag: globalThis.__squealCiInspector === true, wrapped: process.getBuiltinModule !== builtin });`,
  ].join("\n");

/**
 * A Vitest process: `watchWorkers(raw, provider)`, then one forked worker
 * and one worker thread. Whether its env changed, its file, and each
 * worker's hook state.
 */
function vitestProcess(raw: string, provider: boolean): Record<string, unknown> {
  const fork = worker(raw, "/w/test/fork.test.ts", "(v) => console.log(JSON.stringify(v))");
  const thread = worker(
    raw,
    "/w/test/thread.test.ts",
    '(v) => require("node:worker_threads").parentPort.postMessage(v)',
  );
  const script = [
    'const { execFileSync } = require("node:child_process");',
    'const { existsSync } = require("node:fs");',
    'const { Worker } = require("node:worker_threads");',
    `const watch = require(${JSON.stringify(INSPECTOR)});`,
    "const before = JSON.stringify(process.env);",
    `watch.watchWorkers(${JSON.stringify(raw)}, ${provider});`,
    "const envSame = JSON.stringify(process.env) === before;",
    `const file = existsSync(${JSON.stringify(join(raw, "inspector"))} + "/" + process.pid + ".no-provider");`,
    `const fork = JSON.parse(execFileSync(process.execPath, ["-e", ${JSON.stringify(fork)}], { encoding: "utf8" }));`,
    `const w = new Worker(${JSON.stringify(thread)}, { eval: true });`,
    "w.once('message', (thread) => console.log(JSON.stringify({ envSame, file, fork, thread })));",
  ].join("\n");
  // Review of 0.1.444 B3: the old variable's name, allow-listed literally, stays unset.
  return node(["-e", script], { SQUEAL_CI_NO_PROVIDER: undefined });
}

describe("the node:inspector watch beside no coverage provider (reviews 0.1.443-r2 S2, 0.1.444 B3)", () => {
  it("watches the forked and thread workers of a Vitest process with a provider", () => {
    const raw = scratchDir();
    const on = { flag: true, wrapped: true };
    expect(vitestProcess(raw, true)).toEqual({ envSame: true, file: false, fork: on, thread: on });
    expect(logs(raw)).toEqual([
      { t: ["", "/w/test/fork.test.ts"], i: true },
      { t: ["", "/w/test/thread.test.ts"], i: true },
    ]);
  });

  it("without a provider: no worker hook, no log, and the Vitest process's env is unchanged", () => {
    const raw = scratchDir();
    const off = { flag: false, wrapped: false };
    expect(vitestProcess(raw, false)).toEqual({
      envSame: true,
      file: true,
      fork: off,
      thread: off,
    });
    expect(logs(raw)).toBeNull();
  });

  it("removes an earlier file of its pid with a provider; reads no watch for a provider that did not start", () => {
    const raw = scratchDir();
    const script = [
      `const watch = require(${JSON.stringify(INSPECTOR)});`,
      'const { existsSync } = require("node:fs");',
      `const raw = ${JSON.stringify(raw)};`,
      'const file = () => existsSync(raw + "/inspector/" + process.pid + ".no-provider");',
      'const ended = [{ project: "", moduleId: "/w/test/a.test.ts" }];',
      "const failed = () => ({ header: { off: 'failed', note: 'x' }, files: new Map() });",
      "watch.watchWorkers(raw, false);",
      "const off = { file: file(), header: watch.withWatch(failed(), raw, ended).header };",
      "watch.watchWorkers(raw, true);",
      "const on = { file: file(), header: watch.withWatch(failed(), raw, ended).header };",
      "console.log(JSON.stringify({ off, on }));",
    ].join("\n");
    expect(node(["-e", script])).toEqual({
      off: { file: true, header: { off: "failed", note: "x" } },
      on: {
        file: false,
        header: {
          off: "failed",
          note: "x",
          inspector: { loaded: [], unknown: [{ project: "", path: "/w/test/a.test.ts" }] },
        },
      },
    });
  });
});

describe("the preload's watch in the Vitest CLI process (review 0.1.444 S1)", () => {
  /**
   * `main` under the preload, as the recording runs each process: whether it
   * installed the watch, and what its hooks logged when a test file posted a
   * message, called `process.getBuiltinModule` and imported the inspector.
   */
  function preloaded(main: string) {
    const raw = scratchDir();
    const script = join(scratchDir(), main);
    writeFileSync(
      script,
      [
        'const { MessageChannel } = await import("node:worker_threads");',
        "const run = (name) => {",
        '  globalThis.__vitest_worker__ = { filepath: "/w/test/" + name + ".test.ts", ctx: { projectName: "" } };',
        "};",
        'run("post");',
        "const { port1 } = new MessageChannel();",
        'port1.postMessage("x");',
        "port1.close();",
        'run("builtin");',
        'process.getBuiltinModule("node:inspector");',
        'run("import");',
        'await import("node:inspector");',
        "console.log(JSON.stringify({ flag: globalThis.__squealCiInspector === true }));",
        "",
      ].join("\n"),
    );
    const settings = JSON.stringify({ raw });
    const state = node(["--require", join(RUNTIME, "vitest-ci.cjs"), script], {
      SQUEAL_CI_RECORD: settings,
    });
    return { ...state, logs: logs(raw) };
  }

  it("installs no hook in a process that runs Vitest's bin", () => {
    expect(preloaded("vitest.mjs")).toEqual({ flag: false, logs: null });
  });

  it("installs each hook in a worker's process", () => {
    expect(preloaded("forks.mjs")).toEqual({
      flag: true,
      logs: [
        { t: ["", "/w/test/builtin.test.ts"], i: true },
        { t: ["", "/w/test/import.test.ts"], i: true },
        { t: ["", "/w/test/post.test.ts"], i: false },
      ],
    });
  });
});
