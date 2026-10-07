import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Runs the node:test fixtures in place with the Node running this suite, the
 * way spec 003 D5 will: source maps on, the project's argv, `--test`, a reporter writing every
 * event as NDJSON, and a deadline owned by the caller that kills the process
 * group. Proves the fixtures behave as wave 1 expects before any adapter exists.
 */

const fixtures = resolve(import.meta.dirname, "../../fixtures/node-test");
const reporter = join(fixtures, "reporter.mjs");
const scratch = mkdtempSync(join(tmpdir(), "squeal-node-test-fixtures-"));
const SLOW = { timeout: 60_000 } as const;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface TestEvent {
  readonly type: string;
  readonly data: {
    readonly name?: string;
    readonly nesting?: number;
    readonly file?: string;
    readonly line?: number;
    readonly message?: string;
    readonly details?: {
      readonly passed?: boolean;
      readonly error?: { readonly failureType?: string; readonly cause?: unknown };
    };
  };
}

interface NodeRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly killed: boolean;
  readonly events: readonly TestEvent[];
}

function runNode(
  cwd: string,
  argv: readonly string[],
  files: readonly string[],
  deadlineMs = 30_000,
  /** Ends the run early, as the deadline would, once the events so far satisfy it. */
  until?: (events: readonly TestEvent[]) => boolean,
): Promise<NodeRun> {
  const destination = join(scratch, `${randomUUID()}.ndjson`);
  const args = [
    "--enable-source-maps",
    ...argv,
    "--test",
    `--test-reporter=${reporter}`,
    `--test-reporter-destination=${destination}`,
    `--test-concurrency=${files.length}`,
    ...files,
  ];
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: "ignore" });
  return new Promise((done, fail) => {
    let killed = false;
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-(child.pid ?? 0), signal);
      } catch {
        // the group is already gone
      }
    };
    let hard: NodeJS.Timeout | undefined;
    const expire = () => {
      if (killed) return;
      killed = true;
      kill("SIGTERM");
      hard = setTimeout(() => kill("SIGKILL"), 2_000);
    };
    const term = setTimeout(expire, deadlineMs);
    const poll = setInterval(() => {
      if (until?.(readEvents(destination))) expire();
    }, 100);
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      clearTimeout(term);
      clearTimeout(hard);
      clearInterval(poll);
      // children of the runner may outlive it; the group goes with the run
      kill("SIGKILL");
      done({ code, signal, killed, events: readEvents(destination) });
    });
  });
}

function readEvents(path: string): TestEvent[] {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as TestEvent);
}

const named = (run: NodeRun, type: string) =>
  run.events.filter((e) => e.type === type && !e.data.name?.endsWith(".test.ts"));
const names = (run: NodeRun, type: string) => named(run, type).map((e) => e.data.name);
const wrapper = (run: NodeRun, type: string, file: string) =>
  run.events.find((e) => e.type === type && e.data.nesting === 0 && e.data.name === file);
const stderr = (run: NodeRun) =>
  run.events
    .filter((e) => e.type === "test:stderr")
    .map((e) => e.data.message ?? "")
    .join("");

describe("node:test fixtures under the current Node", () => {
  describe("reference: packages/demo with a preload, tsx and a workspace package", () => {
    const demo = join(fixtures, "reference/packages/demo");
    const argv = ["--import", "../../scripts/preload.mjs", "--import", "tsx"];

    it("passes the unit glob with the preload marker set", SLOW, async () => {
      const run = await runNode(demo, argv, ["test/unit/*.test.ts"]);
      expect(run.code).toBe(0);
      expect(names(run, "test:pass").sort()).toEqual([
        "adds",
        "sees the preload",
        "slugs through the workspace package",
        "title",
      ]);
      expect(named(run, "test:fail")).toEqual([]);
    });

    it("passes the e2e glob", SLOW, async () => {
      const run = await runNode(demo, argv, ["test/e2e/*.test.ts"]);
      expect(run.code).toBe(0);
      expect(names(run, "test:pass")).toEqual(["the workspace package resolves by name"]);
    });
  });

  describe("edge", () => {
    const edge = join(fixtures, "edge");
    const argv = ["--import", "tsx"];

    it("loads every specifier form of D3", SLOW, async () => {
      const run = await runNode(edge, argv, ["test/forms.test.ts"]);
      expect(run.code).toBe(0);
      expect(names(run, "test:pass")).toEqual([
        ".js meaning .ts",
        "extensionless",
        "directory index",
        "tsconfig paths",
        "package imports",
        "exports subpath",
        "symlinked workspace package",
        "export from",
        "import type",
        "literal import()",
        "template-literal import()",
        "computed import(p)",
        "require through createRequire",
        "JSON import with type json",
        "readFileSync of a fixture",
        "child_process script",
      ]);
    });

    it("fails one named check with its assertion cause", SLOW, async () => {
      const run = await runNode(edge, argv, ["test/fail.test.ts"]);
      expect(run.code).toBe(1);
      expect(names(run, "test:pass")).toEqual(["passes beside the failure"]);
      const [failure] = named(run, "test:fail");
      expect(failure?.data.name).toBe("fails");
      expect(failure?.data.details?.error?.failureType).toBe("testCodeFailure");
      expect(failure?.data.details?.error?.cause).toMatchObject({
        actual: 1,
        expected: 2,
        operator: "strictEqual",
      });
    });

    it.each([
      ["test/syntax.test.ts", /syntax\.test\.ts:3:14: ERROR: Unexpected "="/],
      ["test/missing-import.test.ts", /ERR_MODULE_NOT_FOUND[\s\S]*src\/does-not-exist\.js/],
    ])("fails %s at file level with the cause in stderr", SLOW, async (file, cause) => {
      const run = await runNode(edge, argv, [file]);
      expect(run.code).toBe(1);
      expect(named(run, "test:pass")).toEqual([]);
      expect(named(run, "test:fail")).toEqual([]);
      expect(wrapper(run, "test:fail", file)).toBeDefined();
      expect(stderr(run)).toMatch(cause);
    });

    it("keeps the other file's completion when the busy loop is killed", SLOW, async () => {
      const busy = "test/busy-loop.test.ts";
      const pass = "test/pass.test.ts";
      // a fixed deadline races the pass file on a loaded machine; end the run once it completed
      const run = await runNode(edge, argv, [busy, pass], 30_000, (events) =>
        events.some((e) => e.type === "test:complete" && e.data.name === pass),
      );
      expect(run.killed).toBe(true);
      expect(run.code === null || run.code !== 0).toBe(true);
      expect(wrapper(run, "test:complete", pass)?.data.details?.passed).toBe(true);
      expect(wrapper(run, "test:complete", busy)).toBeUndefined();
      expect(run.events.some((e) => e.type === "test:summary")).toBe(false);
    });

    it("reports duplicate names as separate checks on separate lines", SLOW, async () => {
      const run = await runNode(edge, argv, ["test/duplicate.test.ts"]);
      expect(run.code).toBe(0);
      const same = named(run, "test:pass").filter((e) => e.data.name === "same name");
      expect(same.map((e) => [e.data.nesting, e.data.line])).toEqual([
        [1, 5],
        [1, 6],
        [0, 8],
        [0, 9],
      ]);
    });
  });

  describe("gen-big.mjs", () => {
    const generator = join(fixtures, "gen-big.mjs");
    // inside the fixtures, as the default output is, so tsx resolves from the repository
    // one directory per run: another Vitest process, such as Squeal's, may share `.tmp/`
    const tmp = join(fixtures, ".tmp", randomUUID());
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));

    const generate = (out: string) => {
      const started = performance.now();
      execFileSync(process.execPath, [generator, out], { stdio: "ignore" });
      return performance.now() - started;
    };
    const digest = (root: string) => {
      const hash = createHash("sha256");
      const files = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => join(e.parentPath, e.name))
        // the workspace symlinks under node_modules lead back into packages/
        .filter((f) => !relative(root, f).startsWith("node_modules/"))
        .sort();
      for (const file of files) hash.update(relative(root, file)).update(readFileSync(file));
      return { hash: hash.digest("hex"), files: files.map((f) => relative(root, f)) };
    };

    it("writes 1,000 modules and 200 test files, deterministically, under 10 s", SLOW, async () => {
      mkdirSync(tmp, { recursive: true });
      const [a, b] = [join(tmp, "a"), join(tmp, "b")];
      expect(generate(a)).toBeLessThan(10_000);
      generate(b);
      const first = digest(a);
      expect(digest(b).hash).toBe(first.hash);
      const modules = first.files.filter((f) =>
        /^packages\/(core|util)\/src\/[mu]\d+\.ts$/.test(f),
      );
      const tests = first.files.filter((f) => f.endsWith(".test.ts"));
      expect([modules.length, tests.length]).toEqual([1_000, 200]);

      const run = await runNode(
        join(a, "packages/core"),
        ["--import", "../../scripts/preload.mjs", "--import", "tsx"],
        ["test/unit/t000.test.ts", "test/unit/t199.test.ts"],
      );
      expect(run.code).toBe(0);
      expect(named(run, "test:fail")).toEqual([]);
      expect(named(run, "test:pass").length).toBeGreaterThan(0);
    });

    it("writes its default output where git ignores it", () => {
      // the trailing slash lets git match the directory pattern before it exists
      const ignored = execFileSync("git", ["check-ignore", "big/"], {
        cwd: fixtures,
        encoding: "utf8",
      });
      expect(ignored.trim()).toBe("big/");
    });
  });
});
