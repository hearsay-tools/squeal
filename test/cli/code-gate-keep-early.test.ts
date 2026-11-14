import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS, codeGateCommand } from "../../src/cli/code-gate.js";
import type { GateReport } from "../../src/core/code/gate/report.js";
import type { GateAdapters } from "../../src/core/code/gate/runners.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter } from "../../src/core/types/runner.js";
import { quiet } from "../code/gate/host-load.js";
import { initRepo, writeFile } from "../hash/git-repo.js";
import { ownHomeAndTmp } from "./code-gate-fixture.js";

/*
 * Spec 020 D17.5 as amended by row 020-59 (#201, #202, #216): the gate
 * runs a runner's files in chunks and writes each chunk's completed files
 * while the next chunk runs. A store another process holds past the bound
 * then costs only the files still queued when the report is out; the
 * report comes first, and the command returns within the bound after it.
 * A file is kept only when its inputs held from the lookup to the end of
 * the chunk that completed it (and to its write). Six node:test files,
 * each loading its own edited `src/<n>.mjs`, in chunks of two.
 */

const SLOW = { timeout: 120_000 } as const;

const NAMES = ["a", "b", "c", "d", "e", "f"];
const TESTS = NAMES.map((n) => `test/${n}.test.mjs`);

const testOf = (name: string) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { double } from "../src/${name}.mjs";\n\ntest("${name}", () => assert.equal(double(2), 4));\n`;
const RAN = "export function double(x) {\n  return x + x;\n}\n";
const EDITED = "export function double(x) {\n  return x * 2 + 0;\n}\n";

/** The fixture repository, each `src/<n>.mjs` edited against `main`. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "squeal-keep-early-"));
  initRepo(root, {
    "package.json": `${JSON.stringify({ name: "keep-early", private: true, type: "module" })}\n`,
    "squeal.config.json": `${JSON.stringify({
      complexity: { enabled: true },
      coverage: { enabled: true },
      nodeTest: [{ name: "t", include: ["test/*.test.mjs"] }],
    })}\n`,
    ...Object.fromEntries(
      NAMES.map((n) => [`src/${n}.mjs`, "export function double(x) {\n  return x * 2;\n}\n"]),
    ),
    ...Object.fromEntries(NAMES.map((n) => [`test/${n}.test.mjs`, testOf(n)])),
  });
  for (const n of NAMES) writeFile(root, `src/${n}.mjs`, RAN);
  return root;
}

const holders: ChildProcess[] = [];
const restores: (() => void)[] = [];
afterEach(() => {
  for (const child of holders.splice(0)) child.kill("SIGKILL");
  for (const restore of restores.splice(0)) restore();
});

/** A second process that holds the store's write lock until `release`. */
async function holder(root: string): Promise<{ readonly pid: number; release(): void }> {
  const script = `const db = new (require("node:sqlite").DatabaseSync)(process.argv[1]); db.exec("BEGIN IMMEDIATE"); process.stdout.write("held\\n"); process.stdin.on("data", () => { db.exec("ROLLBACK"); db.close(); process.exit(0); });`;
  const database = storePaths(join(root, ".git")).database;
  const child = spawn(process.execPath, ["-e", script, database], { stdio: "pipe" });
  holders.push(child);
  await new Promise<void>((done) => child.stdout.once("data", () => done()));
  return { pid: child.pid as number, release: () => child.stdin.write("x") };
}

/** How many keys hold results in `root`'s store. */
function keptKeys(root: string): number {
  const database = storePaths(join(root, ".git")).database;
  if (!existsSync(database)) return 0;
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const row = db.prepare("SELECT count(DISTINCT key) AS n FROM results").get();
    return Number(row?.n);
  } finally {
    db.close();
  }
}

/** Resolves once `root`'s store holds results at `count` keys; throws after 60 s. */
async function kept(root: string, count: number): Promise<void> {
  const until = Date.now() + 60_000;
  while (keptKeys(root) < count) {
    if (Date.now() >= until) throw new Error(`the store holds ${keptKeys(root)} of ${count} keys`);
    await sleep(20);
  }
}

/** The node:test adapter, with `before` awaited before its run number `n` (1 first) and `after` after it. */
function hooked(hooks: {
  readonly before?: (n: number, files: readonly TestFileRef[]) => Promise<void>;
  readonly after?: (n: number, files: readonly TestFileRef[]) => Promise<void>;
}): { readonly adapters: GateAdapters; readonly runs: string[][] } {
  const runs: string[][] = [];
  const wrap = (adapter: RunnerAdapter): RunnerAdapter =>
    new Proxy(adapter, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        if (key !== "run") return value.bind(target);
        return async (...args: Parameters<RunnerAdapter["run"]>) => {
          const [files] = args;
          runs.push(files.map((f) => f.path));
          const n = runs.length;
          await hooks.before?.(n, files);
          const report = await target.run(...args);
          await hooks.after?.(n, files);
          return report;
        };
      },
    });
  return {
    adapters: {
      vitest: ADAPTERS.vitest,
      nodeTest: async (project, options) => wrap(await ADAPTERS.nodeTest(project, options)),
    },
    runs,
  };
}

interface Gate {
  readonly code: number;
  readonly report: GateReport;
  readonly stderr: string;
  /** "report" when stdout was written, "wait" at the busy note, "return" once it returned. */
  readonly order: readonly string[];
  /** Milliseconds from the report to the return. */
  readonly afterReportMs: number;
}

/** `squeal code --base main --json` in `root`, in chunks of `chunkFiles`; `onWait` at the busy note. */
async function gate(
  root: string,
  options: { chunkFiles?: number; adapters?: GateAdapters; onWait?: () => void } = {},
): Promise<Gate> {
  const order: string[] = [];
  let stdout = "";
  let stderr = "";
  let reportAt = 0;
  const code = await codeGateCommand(
    ["--base", "main", "--json"],
    {
      stdout: (text) => {
        stdout += text;
        reportAt = performance.now();
        order.push("report");
      },
      stderr: (text) => {
        stderr += text;
        if (!text.includes("the store is busy")) return;
        order.push("wait");
        options.onWait?.();
      },
      cwd: root,
      env: {},
      hostLoad: quiet,
      ...(options.chunkFiles === undefined ? {} : { chunkFiles: options.chunkFiles }),
    },
    options.adapters ?? ADAPTERS,
  );
  order.push("return");
  const afterReportMs = performance.now() - reportAt;
  return { code, report: JSON.parse(stdout) as GateReport, stderr, order, afterReportMs };
}

/** The selected files the report read from the stores, sorted. */
const fromStores = (gate: Gate) =>
  gate.report.runs
    .flatMap((run) => Object.entries(run.from ?? {}))
    .filter(([, from]) => from === "store")
    .map(([path]) => path)
    .sort();

describe("squeal code --base keeps each chunk's files while the runs go on (row 020-59)", () => {
  it(
    "keeps the files completed before a hold past the bound; only the tail is not kept, after the report",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = fixture();
      const store = openStore(join(root, ".git"));
      if (isStoreOpenFailure(store)) throw new Error(store.reason);
      store.close();
      let held: { readonly pid: number; release(): void } | null = null;
      // Before the third chunk: the first two chunks' four files are in the store, then another process holds it.
      const { adapters, runs } = hooked({
        before: async (n) => {
          if (n !== 3) return;
          await kept(root, 4);
          held = await holder(root);
        },
      });
      // The bound counts on `Date.now`: at the busy note, 30 s pass at once.
      const real = Date.now.bind(Date);
      let skipped = 0;
      const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + skipped);
      restores.push(() => clock.mockRestore());

      const first = await gate(root, {
        chunkFiles: 2,
        adapters,
        onWait: () => {
          skipped = 30_000;
        },
      });
      clock.mockRestore();
      (held as { release(): void } | null)?.release();
      const second = await gate(root);

      expect(runs.map((files) => files.length)).toEqual([2, 2, 2]);
      expect([first.code, first.report.verdict, first.order]).toEqual([
        0,
        "pass",
        ["report", "wait", "return"],
      ]);
      expect(first.afterReportMs).toBeLessThan(10_000);
      const tail = [...(runs[2] ?? [])].sort().join(", ");
      expect(first.stderr).toContain(
        `waiting up to 30 s to keep 2 completed test files (4 kept while the runs went on): ${tail}\n`,
      );
      expect(first.stderr).toMatch(
        /2 completed test files were not kept in the stores: the store stayed busy for 30 s \(held by pid \d+ .*\); the next run will run them again\n/,
      );
      expect(fromStores(second)).toEqual([...(runs[0] ?? []), ...(runs[1] ?? [])].sort());
    },
  );

  it(
    "does not keep a file whose input changed during its chunk; keeps the others",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = fixture();
      let moved = "";
      const { adapters, runs } = hooked({
        after: async (n, files) => {
          if (n !== 1) return;
          // The first file of the first chunk: its input moves before the chunk's end is decided.
          moved = files[0]?.path ?? "";
          writeFile(root, moved.replace(/^test\/(\w+)\.test\.mjs$/, "src/$1.mjs"), EDITED);
        },
      });

      const first = await gate(root, { chunkFiles: 2, adapters });
      // The bytes it ran with again: its key is the first run's lookup's.
      writeFile(root, moved.replace(/^test\/(\w+)\.test\.mjs$/, "src/$1.mjs"), RAN);
      const second = await gate(root);

      // The edit moves a changed function the gate already read, so its verdict may read incomplete.
      expect(runs.length).toBe(3);
      expect(first.stderr).toMatch(
        /1 completed test file was not kept in the stores, because what its key names changed during the run/,
      );
      expect(fromStores(second)).toEqual(TESTS.filter((path) => path !== moved));
    },
  );

  it(
    "keeps a file its chunk wrote though its input changes during a later chunk: the result is true at its key",
    SLOW,
    async () => {
      ownHomeAndTmp();
      const root = fixture();
      let moved = "";
      const { adapters, runs } = hooked({
        before: async (n) => {
          if (n !== 2) return;
          // The first chunk's files are written; then an input of its first file moves.
          await kept(root, 2);
          moved = runs[0]?.[0] ?? "";
          writeFile(root, moved.replace(/^test\/(\w+)\.test\.mjs$/, "src/$1.mjs"), EDITED);
        },
      });

      const first = await gate(root, { chunkFiles: 2, adapters });
      const edited = await gate(root);
      writeFile(root, moved.replace(/^test\/(\w+)\.test\.mjs$/, "src/$1.mjs"), RAN);
      const second = await gate(root);

      expect([first.code, runs.length]).toEqual([0, 3]);
      expect(first.stderr).not.toContain("not kept");
      // On the edited bytes the file has another key, so it runs.
      expect(fromStores(edited)).toEqual(TESTS.filter((path) => path !== moved));
      // On the bytes it ran with, its kept result is read.
      expect(fromStores(second)).toEqual(TESTS);
    },
  );
});
