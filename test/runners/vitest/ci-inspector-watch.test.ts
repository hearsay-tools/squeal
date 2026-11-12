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
 * S1: the Vitest CLI process itself installs no watch. Review of 0.1.444-r2
 * N1: nor does a process or thread a worker of a Vitest process with no
 * provider starts, at any depth. Each case runs in Node processes of its
 * own, as the watch changes their globals.
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

/** A test worker, or a process or thread one started: its test file and what it starts. */
interface Unit {
  readonly kind: "process" | "thread";
  readonly file: string;
  readonly starts?: readonly Unit[];
}

/**
 * The workers of a Vitest process, a forked one and a thread, and what each
 * starts as a test may (review of 0.1.444-r2 N1): the fork a process, which
 * starts one of its own, and a thread; the thread a process.
 */
const WORKERS: readonly Unit[] = [
  {
    kind: "process",
    file: "/w/test/fork.test.ts",
    starts: [
      {
        kind: "process",
        file: "/w/test/fork-child.test.ts",
        starts: [{ kind: "process", file: "/w/test/fork-grandchild.test.ts" }],
      },
      { kind: "thread", file: "/w/test/fork-thread.test.ts" },
    ],
  },
  {
    kind: "thread",
    file: "/w/test/thread.test.ts",
    starts: [{ kind: "process", file: "/w/test/thread-child.test.ts" }],
  },
];

/**
 * Code that runs each of `units` in turn, below `raw`, then calls `then`
 * with their reports in order: a process's JSON output, a thread's message.
 */
function startAll(raw: string, units: readonly Unit[], then: string): string {
  const codes = units.map((unit) => [unit.kind, code(raw, unit)]);
  return [
    'const { execFileSync } = require("node:child_process");',
    'const { Worker } = require("node:worker_threads");',
    "const run = ([kind, code]) =>",
    '  kind === "process"',
    '    ? JSON.parse(execFileSync(process.execPath, ["-e", code], { encoding: "utf8" }))',
    '    : new Promise((done) => new Worker(code, { eval: true }).once("message", done));',
    `const codes = ${JSON.stringify(codes)};`,
    "(async () => {",
    "  const reports = [];",
    "  for (const unit of codes) reports.push(await run(unit));",
    `  (${then})(reports);`,
    "})();",
  ].join("\n");
}

/**
 * The code of `unit`: installs the watch, loads the inspector while its file
 * runs, starts its own, then reports its hook state with theirs (`starts`).
 */
function code(raw: string, unit: Unit): string {
  const report =
    unit.kind === "process"
      ? "(v) => console.log(JSON.stringify(v))"
      : '(v) => require("node:worker_threads").parentPort.postMessage(v)';
  const state =
    "{ flag: globalThis.__squealCiInspector === true, wrapped: process.getBuiltinModule !== builtin }";
  return [
    `const watch = require(${JSON.stringify(INSPECTOR)});`,
    "const builtin = process.getBuiltinModule;",
    `watch.installWatch(${JSON.stringify(raw)}, undefined);`,
    `globalThis.__vitest_worker__ = { filepath: ${JSON.stringify(unit.file)}, ctx: { projectName: "" } };`,
    'process.getBuiltinModule("node:inspector");',
    `const state = ${state};`,
    `const report = ${report};`,
    unit.starts === undefined
      ? "report(state);"
      : startAll(raw, unit.starts, "(starts) => report({ ...state, starts })"),
  ].join("\n");
}

/** What `unit` and each it starts report when every one has hook state `hooks`. */
function reported(unit: Unit, hooks: { flag: boolean; wrapped: boolean }): unknown {
  const starts = unit.starts?.map((u) => reported(u, hooks));
  return starts === undefined ? hooks : { ...hooks, starts };
}

/**
 * A Vitest process: `watchWorkers(raw, provider)`, then its `WORKERS`.
 * Whether its env changed, its file, and the hook state of each worker and
 * of what it started.
 */
function vitestProcess(raw: string, provider: boolean): Record<string, unknown> {
  const script = [
    'const { existsSync } = require("node:fs");',
    `const watch = require(${JSON.stringify(INSPECTOR)});`,
    "const before = JSON.stringify(process.env);",
    `watch.watchWorkers(${JSON.stringify(raw)}, ${provider});`,
    "const envSame = JSON.stringify(process.env) === before;",
    `const file = existsSync(${JSON.stringify(join(raw, "inspector"))} + "/" + process.pid + ".no-provider");`,
    startAll(
      raw,
      WORKERS,
      "([fork, thread]) => console.log(JSON.stringify({ envSame, file, fork, thread }))",
    ),
  ].join("\n");
  // Review of 0.1.444 B3: the old variable's name, allow-listed literally, stays unset.
  return node(["-e", script], { SQUEAL_CI_NO_PROVIDER: undefined });
}

describe("the node:inspector watch beside no coverage provider (reviews 0.1.443-r2 S2, 0.1.444 B3)", () => {
  it("watches the workers of a Vitest process with a provider, and what they start", () => {
    const raw = scratchDir();
    const on = { flag: true, wrapped: true };
    const [fork, thread] = WORKERS.map((unit) => reported(unit, on));
    expect(vitestProcess(raw, true)).toEqual({ envSame: true, file: false, fork, thread });
    expect(logs(raw)).toEqual(
      ["fork-child", "fork-grandchild", "fork-thread", "fork", "thread-child", "thread"].map(
        (name) => ({ t: ["", `/w/test/${name}.test.ts`], i: true }),
      ),
    );
  });

  it("without a provider: no hook and no log in a worker or what it starts; the Vitest process's env is unchanged (review 0.1.444-r2 N1)", () => {
    const raw = scratchDir();
    const off = { flag: false, wrapped: false };
    const [fork, thread] = WORKERS.map((unit) => reported(unit, off));
    expect(vitestProcess(raw, false)).toEqual({ envSame: true, file: true, fork, thread });
    expect(logs(raw)).toBeNull();
  });

  it("a process that watches removes a file an earlier process of its pid left, so what it starts watches too", () => {
    const raw = scratchDir();
    const script = [
      'const fs = require("node:fs");',
      `const watch = require(${JSON.stringify(INSPECTOR)});`,
      `const own = ${JSON.stringify(join(raw, "inspector"))} + "/" + process.pid + ".no-provider";`,
      `fs.mkdirSync(${JSON.stringify(join(raw, "inspector"))}, { recursive: true });`,
      'fs.writeFileSync(own, "");',
      `watch.installWatch(${JSON.stringify(raw)}, undefined);`,
      "console.log(JSON.stringify({ flag: globalThis.__squealCiInspector === true, file: fs.existsSync(own) }));",
    ].join("\n");
    expect(node(["-e", script])).toEqual({ flag: true, file: false });
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
