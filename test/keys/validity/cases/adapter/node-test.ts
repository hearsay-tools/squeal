import type { Case } from "../../case.js";

/*
 * The node:test adapter's decisions (011 C14, spec 003 D1 to D6, row
 * 016-17), on the driver's own Node: what a run stores (outcomes, a file
 * that fails to load), and from row 016-17 the directories a test creates,
 * which the module recorder records for the core's written-directory bound
 * (016 D4), from row 015-86 Squeal's coverage of those runs (015 D8), and
 * from row 020-36 what a process a test spawns loads (020 D12.6).
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const PACKAGE = `${JSON.stringify({ name: "validity", type: "module" })}\n`;

const OUTCOMES: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "test/pass.test.mjs": lines('import { test } from "node:test";', "", 'test("passes", () => {});'),
  "test/fail.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    'test("passes", () => {});',
    'test("fails", () => {',
    "  assert.equal(1, 2);",
    "});",
  ),
  "test/broken.test.mjs": lines('import "./validity-missing-module.mjs";'),
};

/** Row 016-17: a test that reads its own directory create from the record only 016 D4's recorder writes. */
const SEES_WRITTEN: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "test/sees-written.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { mkdirSync, readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { fileURLToPath } from "node:url";',
    "",
    'test("sees the directory it made recorded as written", () => {',
    '  const made = fileURLToPath(new URL("./made", import.meta.url));',
    "  mkdirSync(made);",
    '  const graph = process.env.SQUEAL_NODE_TEST_GRAPH + "-" + process.pid + ".ndjson";',
    '  const written = readFileSync(graph, "utf8")',
    '    .split("\\n")',
    "    .filter((line) => line.includes('\"written\"'))",
    "    .map((line) => JSON.parse(line).written);",
    "  assert.ok(written.includes(made), JSON.stringify(written));",
    "});",
  ),
};

/** Row 015-86: a source a test file runs in part, and a test file whose closure imports the inspector. */
const COVERED: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "src/area.mjs": lines(
    "export function area(w, h) {",
    "  return w * h;",
    "}",
    "",
    "export function neverCalled() {",
    '  return "no";',
    "}",
  ),
  "test/area.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { area } from "../src/area.mjs";',
    "",
    'test("area", () => assert.equal(area(2, 3), 6));',
  ),
  "test/inspector.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { Session } from "node:inspector";',
    'import { test } from "node:test";',
    "",
    'test("opens a session", () => assert.ok(new Session()));',
  ),
};

/**
 * Row 018-36: a child Node's failure as `execFileSync` words it, after Node
 * failed parsing `bad/package.json` at a `--require` preload: Node 24's
 * stack, which ends at the preload's frame, and Node 26's, which Node's 10
 * frames cut inside the loader before it.
 */
const PRELOAD_FAILURES = {
  "Node 24's stack": [
    "Error: Invalid package config /tmp/x/bad/package.json.",
    "    at Object.getNearestParentPackageJSON (node:internal/modules/package_json_reader:197:35)",
    "    at trySelf (node:internal/modules/cjs/loader:662:33)",
    "    at Module._resolveFilename (node:internal/modules/cjs/loader:1548:24)",
    "    at Module._load (node:internal/modules/cjs/loader:1341:5)",
    "    at Module.require (node:internal/modules/cjs/loader:1674:12)",
    "    at node:internal/modules/cjs/loader:2221:12 {",
    "  code: 'ERR_INVALID_PACKAGE_CONFIG'",
    "}",
  ],
  "Node 26's cut stack": [
    "Error: Invalid package config /tmp/x/bad/package.json.",
    "    at getNearestParentPackageJSON (node:internal/modules/helpers:87:20)",
    "    at Object.loaderMethodWrapper [as getNearestParentPackageJSON] (node:internal/modules/helpers:123:12)",
    "    at Object.getNearestParentPackageJSON (node:internal/modules/package_json_reader:200:34)",
    "    at trySelf (node:internal/modules/cjs/loader:673:33)",
    "    at Module._resolveFilename (node:internal/modules/cjs/loader:1587:24)",
    "    at wrapResolveFilename (node:internal/modules/cjs/loader:1145:27)",
    "    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1169:10)",
    "    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1196:12)",
    "    at Module._load (node:internal/modules/cjs/loader:1370:5)",
    "    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19) {",
    "  code: 'ERR_INVALID_PACKAGE_CONFIG'",
    "}",
  ],
};

/** Row 018-36: a project whose own `--require` puts the recorder in `NODE_OPTIONS`, and a test per failure above. */
const PRELOADED: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "validity-preload.cjs": "",
  "test/preload.test.mjs": lines(
    'import { test } from "node:test";',
    "",
    "const failed = (stderr) =>",
    '  new Error(["Command failed: node --require /tmp/x/pre.cjs /tmp/x/pre.cjs", ...stderr].join("\\n"));',
    ...Object.entries(PRELOAD_FAILURES).map(
      ([name, stderr]) =>
        `test(${JSON.stringify(name)}, () => { throw failed(${JSON.stringify(stderr)}); });`,
    ),
  ),
};

/**
 * Row 018-38: a file that completes, then one that removes the case's run
 * logs, `<scratch>/logs` beside the harness's `<scratch>/worktree`, as it runs.
 */
const LOGS_REMOVED: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "test/pass.test.mjs": lines('import { test } from "node:test";', "", 'test("passes", () => {});'),
  "test/removes-logs.test.mjs": lines(
    'import { rmSync } from "node:fs";',
    'import { test } from "node:test";',
    "",
    'test("removes the run logs", () => {',
    '  rmSync(new URL("../../logs", import.meta.url), { recursive: true, force: true });',
    "});",
  ),
};

/**
 * Row 018-38, review 0.1.449 B1: a file that passes after a load its static
 * closure lacks, then one that removes the case's run logs (`<scratch>/logs`,
 * beside the harness's `<scratch>/worktree`) and leaves the store in place.
 */
const LOGS_REMOVED_COVERED: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "src/dep.mjs": "export const value = 1;\n",
  "test/first.test.mjs": lines(
    'import { test } from "node:test";',
    "",
    'test("first", async () => { await import("../src/" + "dep.mjs"); });',
  ),
  "test/removes-logs.test.mjs": LOGS_REMOVED["test/removes-logs.test.mjs"] ?? "",
};

/**
 * Row 020-36: a test that runs a module it also imports in a process of its
 * own, then reads that process's graph, which only a recorder in
 * `NODE_OPTIONS` writes. The import keeps the key alike at both trees.
 */
const CHILD_RECORDED: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "src/child.mjs": "export const marker = 1;\n",
  "test/child-recorded.test.mjs": lines(
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { fileURLToPath } from "node:url";',
    'import { marker } from "../src/child.mjs";',
    "",
    "test(\"finds its child's load in the run's graph\", () => {",
    '  const script = fileURLToPath(new URL("../src/child.mjs", import.meta.url));',
    '  const child = spawnSync(process.execPath, [script], { encoding: "utf8" });',
    "  assert.equal(child.status, 0, child.stderr);",
    '  const graph = process.env.SQUEAL_NODE_TEST_GRAPH + "-" + child.pid + ".ndjson";',
    '  assert.match(readFileSync(graph, "utf8"), /src\\/child\\.mjs/);',
    "  assert.equal(marker, 1);",
    "});",
  ),
};

const COVERED_RUN = [{ files: ["test/area.test.mjs", "test/inspector.test.mjs"] }];

const OUTCOME_FILES = ["test/broken.test.mjs", "test/fail.test.mjs", "test/pass.test.mjs"];

/**
 * Row 005-88: a worktree whose `.git` names a git dir whose `commondir` is a
 * directory, so reading the layout throws.
 */
const UNREADABLE_GIT: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  ".git": "gitdir: meta\n",
  "meta/commondir/unreadable": "",
  "test/pass.test.mjs": lines('import { test } from "node:test";', "", 'test("passes", () => {});'),
};

/**
 * Row 020-31 (#193): a project whose argv names an async loader, so the
 * adapter's loader-thread note, whose hint now names the top-level
 * `inputs` key, is written; the loader only passes resolution on.
 */
const ASYNC_LOADER: Readonly<Record<string, string>> = {
  "package.json": PACKAGE,
  "validity-loader.mjs": lines(
    "export async function resolve(specifier, context, next) {",
    "  return next(specifier, context);",
    "}",
  ),
  "test/pass.test.mjs": lines('import { test } from "node:test";', "", 'test("passes", () => {});'),
};

export const NODE_TEST_RUNS: readonly Case[] = [
  {
    kind: "adapter:node-test",
    name: "outcomes of a passing file, a failing one and one that fails to load",
    why: "003 D2 and D4: each test's outcome and fingerprint, and a file whose import fails, decide the rows a run stores",
    input: { files: OUTCOMES, runs: [{ files: OUTCOME_FILES }] },
  },
  {
    kind: "adapter:node-test",
    name: "runs in a configured group's lane, the slow lane and the adapter's own store alike (rows 019-12, 019-18)",
    why: "004 D2 and 019 D3: a run in a check group's lane (`isGroupLane`: `slow:` or `group:<name>:`) starts every file it holds, and one in the adapter's own lane at most `concurrency`; how many start at once decides no outcome, so each run stores what the last release stored, which reads `group:e2e:node-test` as its own lane",
    input: {
      files: OUTCOMES,
      concurrency: 1,
      runs: [
        { files: OUTCOME_FILES, lane: "group:e2e:node-test" },
        { files: OUTCOME_FILES, lane: "slow:node-test" },
        { files: OUTCOME_FILES, lane: "node-test" },
      ],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a test sees the directory it made recorded as written",
    why: "016 D4, the case that stands for NODE_TEST_ADAPTER_VERSION 10. Observable: the module recorder records each directory a test creates or removes in the run's graph, so under one key a test that reads it stores a pass where the last release stored a fail. The reason for the raise: the core now keeps what runs loaded, a git-ignored load unless the run created or removed one of its directories, and loads key whatever observe.runtimeInputs says; this kind reads closures as keys, so the change of what is kept shows here through the recorder (the human, 2026-10-25)",
    input: { files: SEES_WRITTEN, runs: [{ files: ["test/sees-written.test.mjs"] }] },
  },
  {
    kind: "adapter:node-test",
    name: "a run with coverage on stores its outcomes and a coverage record (row 015-86)",
    why: "015 D8 as amended for 015-86: with coverage on, each completed file's own process gives a coverage record and no outcome changes, so the candidate stores more; a file whose closure imports node:inspector runs without, with a note. The key's coverage marker is wording, since a coverage-on key re-keys every node:test check once by design",
    input: { files: COVERED, coverage: true, runs: COVERED_RUN },
  },
  {
    kind: "adapter:node-test",
    name: "a run with coverage off keeps the last release's keys and outputs (row 015-86)",
    why: "015 D8 Keys: with coverage off a node:test key holds no coverage marker and no run takes coverage, so keys and outputs stay the last release's unless a change moves every node:test key (018 D12 did once: the Node's build in place of its path)",
    input: { files: COVERED, coverage: "off", runs: COVERED_RUN },
  },
  {
    kind: "adapter:node-test",
    name: "a project under --test-isolation=none takes no coverage (row 015-86)",
    why: "015 D8 as amended for 015-86: test files that run in the node --test process take no coverage, as a Vitest isolate: false project, with a note, and key as with coverage off",
    input: {
      files: COVERED,
      argv: ["--test-isolation=none"],
      coverage: true,
      runs: [{ files: ["test/area.test.mjs"] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a --require preload's ERR_INVALID_PACKAGE_CONFIG, under the recorder in NODE_OPTIONS, stores alike (row 018-36)",
    why: "001 D11 Fidelity (task 001-390): a failure with a recorder's signature says so in its summary, never in its fingerprint; since 018-36 Node 26's cut stack carries it too, beside a --require option. With the project's own --require the recorder is in NODE_OPTIONS, so each failure is read for the signature, and each run stores what the last release stored: Node 24's stack was named there already, Node 26's only in the summary's wording",
    input: {
      files: PRELOADED,
      env: { NODE_OPTIONS: "--require ./validity-preload.cjs" },
      runs: [{ files: ["test/preload.test.mjs"] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a stopped node:test run under a store that is gone makes no folder and stores nothing, as the last release (row 018-38)",
    why: "018-38: a runner host whose daemon died stops each run it still starts, and the checkout holding the store may be gone; the candidate makes no folder there and reports nothing, where the last release made the folder again and started nothing, so neither stores a file. The run before it, under a store that is there, stores alike",
    input: {
      files: OUTCOMES,
      runs: [{ files: ["test/pass.test.mjs"] }, { files: ["test/pass.test.mjs"], storeGone: true }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a node:test run whose log folder goes while it runs stores nothing (row 018-38)",
    why: "018-38: the first file completes, the second removes the run's logs, and with them the graphs a completed file's observed closure is read from at the run's end; the candidate reports nothing then, and the last release throws reading them, so it stored nothing either",
    lastThrows: "ENOENT: no such file or directory, scandir",
    input: {
      files: LOGS_REMOVED,
      concurrency: 1,
      runs: [{ files: ["test/pass.test.mjs", "test/removes-logs.test.mjs"] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a covered run whose log folder goes after a file passed stores nothing (row 018-38)",
    why: "018-38, the case that stands for NODE_TEST_ADAPTER_VERSION 11. Observable: with coverage on, the first file passes after loading src/dep.mjs at run time and the second removes only the run's logs, the store left in place; the last release's covered process makes the log folder again as it exits, so the run stores the first file's pass without the loads its removed graphs held, under a key that lacks them, where the candidate's run mark rejects the run and it stores nothing. The reason for the raise: a result an earlier release stored that way must not be found by this release's keys (review 0.1.449 B1; the human, 2026-11-12: \"A: raise version\")",
    input: {
      files: LOGS_REMOVED_COVERED,
      coverage: true,
      concurrency: 1,
      runs: [{ files: ["test/first.test.mjs", "test/removes-logs.test.mjs"] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a project with an async loader in its argv runs and stores alike (row 020-31)",
    why: "020 D14.4 as amended for 020-31 (#193): the loader-thread note's hint now names the top-level inputs key of squeal.config.json; the note is wording, so the run stores what the last release stored",
    input: {
      files: ASYNC_LOADER,
      argv: ["--experimental-loader=./validity-loader.mjs"],
      runs: [{ files: ["test/pass.test.mjs"] }],
    },
  },
  {
    kind: "adapter:node-test",
    name: "a test finds its child process's load recorded (row 020-36)",
    why: "020 D12.6 as amended 2026-11-12, the case that stands for NODE_TEST_ADAPTER_VERSION 12. Observable: the module recorder now rides in NODE_OPTIONS for every project, so a process a test spawns writes its own graph, whose loads key the test file; under one key a test that reads its child's graph stores a pass where the last release, whose recorder reached no child of a project that is not slow, stored a fail. The child runs a module the test file imports too, so the keys stay alike. The reason for the raise: a pass an earlier release stored while a child's loads went unkeyed must not be found by this release's keys (the human, 2026-11-12: \"Record them\")",
    input: { files: CHILD_RECORDED, runs: [{ files: ["test/child-recorded.test.mjs"] }] },
  },
  {
    kind: "adapter:node-test",
    name: "a worktree whose git metadata cannot be read runs and stores alike (row 005-88)",
    why: "005 D3, project-first process commands: the node:test leader's display label reads the worktree's git layout, and a layout it cannot read keeps the command as argv0, so the leader still starts and its run stores what the last release stored",
    input: { files: UNREADABLE_GIT, runs: [{ files: ["test/pass.test.mjs"] }] },
  },
];
