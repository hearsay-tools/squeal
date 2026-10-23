import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { BASE, createRepo, stored } from "./stamps-repo.js";

/*
 * Task 013-02 (013 V5 Touched files and 011 C2 as amended 2026-10-20),
 * gh-33's probes T1 and T2 (`011-core/research/issue-33-dist.md`): a
 * same-bytes rewrite of build output while a Vitest tier runs. `slow1`
 * imports the gitignored `dist/gen.js`; `slow2` and `slow3` do not, and no
 * Vitest file loads `dist/unrelated.js`. A node:test project's test imports
 * it, so it is watched as an extra file, as cezar's `test:package` files
 * named its `dist` (a cached row nothing names is dropped at start, row
 * 011-36). `slow1` appends to `flags/started` and waits until `flags/heard`
 * is as long.
 */

const slow = (imports: string, check: string, held: boolean) =>
  [
    'import { appendFileSync, existsSync, readFileSync } from "node:fs";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { one } from "../src/lib.ts";',
    imports,
    'const at = (path: string) => new URL("../" + path, import.meta.url);',
    'const length = (path: string) => (existsSync(at(path)) ? readFileSync(at(path), "utf8").length : 0);',
    'it("passes", async () => {',
    held ? '  appendFileSync(at("flags/started"), "x");' : "",
    held ? '  const run = length("flags/started");' : "",
    held ? '  for (let i = 0; i < 600 && length("flags/heard") < run; i++) await sleep(50);' : "",
    `  expect(one).toBe(1);${check}`,
    "});",
    "",
  ].join("\n");

const FILES: Readonly<Record<string, string>> = {
  ...BASE,
  ".gitignore": "node_modules/\nflags/\ndist/\n",
  "flags/.keep": "\n",
  "src/lib.ts": "export const one = 1;\n",
  "dist/gen.js": "export const g = 1;\n",
  "dist/unrelated.js": "export const u = 1;\n",
  "test/slow1.test.ts": slow('import { g } from "../dist/gen.js";', " expect(g).toBe(1);", true),
  "test/slow2.test.ts": slow("", "", false),
  "test/slow3.test.ts": slow("", "", false),
  "pkg/test/unrelated.test.mjs": [
    'import { test } from "node:test";',
    'import { u } from "../../dist/unrelated.js";',
    'test("imports the build", () => u);',
    "",
  ].join("\n"),
};

/** The node:test project whose test imports `dist/unrelated.js`. */
const PKG: NodeTestProject = {
  name: "pkg",
  cwd: "pkg",
  node: process.execPath,
  argv: [],
  env: {},
  include: ["test/*.test.mjs"],
};

const SLOW_FILES = ["test/slow1.test.ts", "test/slow2.test.ts", "test/slow3.test.ts"];

interface Rig {
  readonly h: Harness;
  /** Touch paths the runner heard. */
  readonly heard: string[];
}

/** A scheduler over `FILES`, with the node:test project `PKG` when `pkg`. */
async function rig(pkg = false): Promise<Rig> {
  const repo = createRepo(FILES);
  const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    tierSize: 4,
    runnerPartBesideRun: true,
    ...(pkg ? { nodeTest: [PKG], policy: { nodeTest: [PKG] } } : {}),
  });
  const heard: string[] = [];
  const invalidate = h.runner.invalidate;
  h.runner.invalidate = (paths) => {
    heard.push(...paths.filter((p) => p.kind === "touch").map((p) => p.path));
    return invalidate(paths);
  };
  return { h, heard };
}

const flag = (h: Harness, name: string) => join(h.root, "flags", name);
const length = (h: Harness, name: string) =>
  existsSync(flag(h, name)) ? readFileSync(flag(h, name), "utf8").length : 0;

/**
 * Once `slow1`'s run number `run` started, `path` is rewritten with its own
 * bytes, the batch is handed over and, once the runner heard the touch, the
 * run is released.
 */
async function touchDuring(r: Rig, path: string, run: number): Promise<void> {
  const { h } = r;
  for (let i = 0; i < 1200 && length(h, "started") < run; i++) await sleep(25);
  expect(length(h, "started")).toBe(run);
  const before = r.heard.length;
  h.write(path, readFileSync(join(h.root, path), "utf8"));
  await h.batch(path);
  for (let i = 0; i < 1200 && !r.heard.slice(before).includes(path); i++) await sleep(25);
  expect(r.heard.slice(before)).toContain(path);
  appendFileSync(flag(h, "heard"), "x");
}

/** Lets every later run of `slow1` through. */
const releaseAll = (h: Harness) => appendFileSync(flag(h, "heard"), "x".repeat(1_000));

const runs = (h: Harness) => SLOW_FILES.map((path) => h.runsOf(path).length);

/** The Vitest files' stored states, without the node:test project's. */
const storedSlow = (h: Harness) =>
  stored(h).filter(([, path]) => path !== undefined && SLOW_FILES.includes(path));

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

const current = SLOW_FILES.map((path) => ["", path, "current", "pass"]);

/** Edits `src/lib.ts`, which every slow file imports, and hands the batch over. */
async function editLib(h: Harness): Promise<void> {
  h.write("src/lib.ts", `${readFileSync(join(h.root, "src/lib.ts"), "utf8")}// edited\n`);
  await h.batch("src/lib.ts");
}

describe(
  "a same-bytes rewrite of build output while a Vitest tier runs (013-02, gh-33)",
  SLOW,
  () => {
    it("stores every file from its run when no test file loads the path (T1 and T2, 9 and 10)", async () => {
      const r = await rig(true);
      await r.h.scheduler.start();
      await touchDuring(r, "dist/unrelated.js", 1);
      await r.h.scheduler.idle();
      expect(runs(r.h)).toEqual([1, 1, 1]);
      expect(storedSlow(r.h)).toEqual(current);

      // T2: a second rewrite during the next run.
      await editLib(r.h);
      await touchDuring(r, "dist/unrelated.js", 2);
      releaseAll(r.h);
      await r.h.scheduler.idle();
      expect(runs(r.h)).toEqual([2, 2, 2]);
      expect(storedSlow(r.h)).toEqual(current);
      expect(r.h.header()).toMatchObject({ counts: { pending: 0, unknown: 0 } });
    });

    it("withholds only the file that loads the path, which ends unknown (T1 and T2, 11)", async () => {
      const r = await rig();
      await r.h.scheduler.start();
      await touchDuring(r, "dist/gen.js", 1);
      await touchDuring(r, "dist/gen.js", 2);
      releaseAll(r.h);
      await r.h.scheduler.idle();

      // D2: the barrier withholds only the file whose key names the path, as the runner does.
      expect(runs(r.h)).toEqual([2, 1, 1]);
      expect(stored(r.h)).toEqual(current.slice(1));
      expect(reasons(r.h, "test/slow1.test.ts")).toEqual([
        expect.stringMatching(/dist\/gen\.js was written during this run.*task 001-159/s),
      ]);
      expect(reasons(r.h, "test/slow2.test.ts")).toEqual([]);
    });
  },
);
