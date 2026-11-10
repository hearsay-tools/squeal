import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ciCommand } from "../../src/cli/ci.js";
import type { CliIo } from "../../src/cli/main.js";
import { PART_FORMAT, type Part, readPart } from "../../src/core/ci/parts.js";

/*
 * Spec 018 D8, row 018-16: `squeal ci record [--out <dir>] -- <command>`
 * runs the project's own Vitest command unchanged, exits with its code, and
 * writes one part per Vitest process. The fixture lives inside the
 * repository, so its Vitest resolves from the repository's `node_modules`.
 */

const REPO = resolve(import.meta.dirname, "../..");
const VITEST = join(REPO, "node_modules/vitest/vitest.mjs");
const SCRATCH = join(REPO, "test/fixtures/vitest/.tmp");
const SLOW = { timeout: 180_000 } as const;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(name: string): string {
  const dir = join(SCRATCH, `${name}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  made.push(dir);
  return dir;
}

/** Four test files, each reading its own data file, in a git repository of their own. */
function fixture(extra: Readonly<Record<string, string>> = {}): string {
  const root = scratch("ci-record");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "ci-record-fixture", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    ...Object.fromEntries(
      ["a", "b", "c", "d"].flatMap((name) => [
        [`data/${name}.txt`, `${name}\n`],
        [
          `test/${name}.test.ts`,
          `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("reads ${name}", () => {\n  expect(readFileSync(new URL("../data/${name}.txt", import.meta.url), "utf8")).toBe("${name}\\n");\n});\nit.skip("waits ${name}", () => {});\n`,
        ],
      ]),
    ),
    ...extra,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "f"], {
    cwd: root,
  });
  return root;
}

function io(cwd: string): { io: CliIo; out: () => string } {
  let text = "";
  const add = (chunk: string) => {
    text += chunk;
  };
  return { io: { stdout: add, stderr: add, cwd, env: process.env }, out: () => text };
}

function partsIn(dir: string): Part[] {
  return readdirSync(dir).map((name) => {
    const part = readPart(join(dir, name));
    if (typeof part === "string") throw new Error(part);
    return part;
  });
}

/** Every path under `root`, relative and sorted, `.git` left out. */
function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === ".git") continue;
      out.push(relative(root, path));
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(root);
  return out.sort();
}

const record = (root: string, out: string, command: readonly string[], temp?: string) => {
  const capture = io(root);
  const code = ciCommand(
    ["record", "--out", out, "--", ...command],
    capture.io,
    temp === undefined ? {} : { tempDir: temp },
  );
  return Promise.resolve(code).then((exit) => ({ exit, text: capture.out() }));
};

describe("squeal ci record", () => {
  it(
    "writes disjoint parts for two shards, each file with its checks and observed reads",
    SLOW,
    async () => {
      const root = fixture();
      const out = join(root, "parts");
      const node = process.execPath;
      const first = await record(root, out, [node, VITEST, "run", "--shard=1/2"]);
      const second = await record(root, out, [node, VITEST, "run", "--shard=2/2"]);
      expect([first.exit, second.exit]).toEqual([0, 0]);

      const parts = partsIn(out);
      expect(parts).toHaveLength(2);
      const [one, two] = parts.map((part) => part.testFiles.map((f) => f.path));
      expect(one?.length).toBeGreaterThan(0);
      expect(two?.length).toBeGreaterThan(0);
      expect(one?.filter((path) => two?.includes(path))).toEqual([]);
      expect([...(one ?? []), ...(two ?? [])].sort()).toEqual([
        "test/a.test.ts",
        "test/b.test.ts",
        "test/c.test.ts",
        "test/d.test.ts",
      ]);

      const part = parts[0] as Part;
      expect(part.format).toBe(PART_FORMAT);
      expect(part.header).toMatchObject({ runner: "vitest", end: "completed", observing: true });
      expect(part.header.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(part.projects).toHaveLength(1);
      // `new` here, `none` where std-env reads a CI environment.
      expect(part.projects[0]?.updateSnapshot).toMatch(/^(new|none)$/);
      expect(part.projects[0]?.descriptor).toMatchObject({ runnerName: "vitest" });
      expect(part.projects[0]?.descriptor.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
      expect(Object.keys(part.projects[0]?.descriptor.config ?? {})).toContain("allowOnly");

      for (const file of parts.flatMap((p) => p.testFiles)) {
        const name = file.path.slice("test/".length, -".test.ts".length);
        expect(file.outcome).toBe("pass");
        expect(file.durationMs).toBeGreaterThan(0);
        expect(file.checks.map((c) => [c.fullName, c.outcome])).toEqual([
          [`reads ${name}`, "pass"],
          [`waits ${name}`, "skip"],
        ]);
        expect(file.observed?.paths).toContain(`data/${name}.txt`);
      }

      // Row 018-29: each command states what Squeal's hooks took, in its parts and its output.
      const costs = parts.map((p) => p.header.cost);
      for (const cost of costs) {
        expect(cost?.command).toMatch(/^[0-9a-f-]{36}$/);
        expect(cost?.hooksMs).toBeGreaterThan(0);
        // The Vitest process and at least one test worker.
        expect(cost?.threads).toBeGreaterThanOrEqual(2);
        expect(cost?.afterMs).toBeGreaterThanOrEqual(0);
      }
      expect(costs[0]?.command).not.toBe(costs[1]?.command);
      const said =
        /Squeal's recording took \d+\.\d+ s in \d+ processes and threads, \d+\.\d% of the test time \(\d+\.\d+ s\); \d+\.\d+ s more after the command\n/;
      expect(first.text).toMatch(said);
      expect(second.text).toMatch(said);
      const exported = io(root);
      const results = join(scratch("ci-record-export"), "results.json.gz");
      await ciCommand(["export", "--parts", out, "--out", results], exported.io);
      expect(exported.out()).toMatch(
        /squeal ci export: Squeal's recording took \d+\.\d+ s in \d+ processes and threads of 2 commands, \d+\.\d% of the test time/,
      );
    },
  );

  it(
    "exits with the command's code: a pass, a failing test, a crash, a non-Vitest command",
    SLOW,
    async () => {
      const root = fixture({
        "test/fails.test.ts": `import { expect, it } from "vitest";\nit("fails", () => expect(1).toBe(2));\n`,
      });
      const node = process.execPath;
      const plain = (args: readonly string[]) =>
        spawnSync(node, [VITEST, ...args], { cwd: root, stdio: "ignore" }).status;

      const pass = await record(root, join(root, "p1"), [node, VITEST, "run", "test/a.test.ts"]);
      expect(pass.exit).toBe(0);

      const failing = ["run", "test/a.test.ts", "test/fails.test.ts"];
      const fail = await record(root, join(root, "p2"), [node, VITEST, ...failing]);
      expect(fail.exit).toBe(plain(failing));
      expect(fail.exit).toBe(1);
      const failed = partsIn(join(root, "p2"))[0]?.testFiles;
      expect(failed?.map((f) => [f.path, f.outcome])).toEqual([
        ["test/a.test.ts", "pass"],
        ["test/fails.test.ts", "fail"],
      ]);

      // An error outside every test file: Vitest's own code, and a part that trusts no file.
      writeFileSync(
        join(root, "test/a.test.ts"),
        `import { it } from "vitest";\nit("leaks", () => { setTimeout(() => { throw new Error("outside"); }, 0); });\n`,
      );
      const crashing = ["run", "test/a.test.ts"];
      const crash = await record(root, join(root, "p3"), [node, VITEST, ...crashing]);
      expect(crash.exit).toBe(plain(crashing));
      expect(crash.exit).not.toBe(0);
      const crashed = partsIn(join(root, "p3"));
      expect(crashed.flatMap((p) => p.testFiles).filter((f) => f.outcome === "pass")).toEqual([]);

      const other = await record(root, join(root, "p4"), [node, "-e", "process.exit(3)"]);
      expect(other.exit).toBe(3);
      expect(other.text).toContain("no Vitest run");
    },
  );

  it(
    "writes nothing outside --out: the tree a plain run leaves, and no temp directory",
    SLOW,
    async () => {
      const root = fixture();
      const node = process.execPath;
      // Twice: the first run makes the fixture's `node_modules`, where the second puts `.vite-temp`.
      for (let i = 0; i < 2; i++) spawnSync(node, [VITEST, "run"], { cwd: root, stdio: "ignore" });
      const before = tree(root);
      const out = scratch("ci-record-out");
      const temp = scratch("ci-record-temp");
      const run = await record(root, out, [node, VITEST, "run"], temp);
      expect(run.exit).toBe(0);
      expect(tree(root)).toEqual(before);
      expect(readdirSync(temp)).toEqual([]);
      expect(readdirSync(out).every((name) => name.endsWith(".json"))).toBe(true);
    },
  );
});
