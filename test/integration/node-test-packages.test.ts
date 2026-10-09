import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { childEnv, ping } from "../daemon/helpers.js";
import { readRuns, until } from "../e2e/support.js";
import { type FixturePackage, writeInstall } from "../keys/install.js";

/*
 * Review wave-3 B1 and B2 (task 003-33) through a daemon run from the
 * sources: an install that bumps `ext` from value 1 to value 2, with every
 * project file unchanged, re-runs exactly the node:test files that reach
 * `ext` (a `#` alias, `createRequire` through `process.getBuiltinModule`, a
 * `NODE_OPTIONS` preload through an alias) and reports their `PASS -> FAIL`
 * at the new revision; the file that imports nothing installed keeps its pass.
 */

const REPO = resolve(import.meta.dirname, "../..");
const CLI = join(REPO, "src/cli/index.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-node-test-install-")));
const runtime = realpathSync(mkdtempSync("/tmp/sq-"));
const SLOW = { timeout: 300_000 } as const;
const SETTLE_MS = 120_000;

const daemons: ChildProcess[] = [];
afterAll(async () => {
  for (const daemon of daemons) daemon.kill("SIGTERM");
  await Promise.all(
    daemons.map((d) => (d.exitCode === null ? new Promise((done) => d.once("exit", done)) : null)),
  );
  rmSync(scratch, { recursive: true, force: true });
  rmSync(runtime, { recursive: true, force: true });
});

const ext = (value: number): Record<string, FixturePackage> => ({
  "node_modules/ext": {
    version: `${value}.0.0`,
    manifest: { type: "module", main: "index.js" },
    files: {
      "index.js": `export const value = ${value};\n`,
      "value.cjs": `module.exports = { value: ${value} };\n`,
    },
  },
});

const testFile = (head: string, actual: string) =>
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\n${head}\ntest("value", () => assert.equal(${actual}, 1));\n`;

const PROJECTS = [
  { name: "p", node: process.execPath, argv: [], env: {}, include: ["test/*.test.mjs"] },
  {
    name: "q",
    node: process.execPath,
    argv: [],
    env: { NODE_OPTIONS: "--import ./scripts/setup.mjs" },
    include: ["preloaded/*.test.mjs"],
  },
];

const FILES: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "package.json": `${JSON.stringify({ name: "app", private: true, type: "module", imports: { "#ext": "ext" } })}\n`,
  "squeal.config.json": `${JSON.stringify({ nodeTest: PROJECTS }, null, 2)}\n`,
  "test/alias.test.mjs": testFile('import { value } from "#ext";', "value"),
  "test/require.test.mjs": testFile(
    "const r = process.getBuiltinModule('module').createRequire(import.meta.url);",
    "r('ext/value.cjs').value",
  ),
  "test/plain.test.mjs": testFile("const value = 1;", "value"),
  "scripts/setup.mjs": 'import { value } from "#ext";\nglobalThis.extValue = value;\n',
  "preloaded/setup.test.mjs": testFile("", "globalThis.extValue"),
};
const TEST_FILES = Object.keys(FILES).filter((p) => p.endsWith(".test.mjs"));
const REACHING = ["preloaded/setup.test.mjs", "test/alias.test.mjs", "test/require.test.mjs"];

function createRepo(): string {
  const root = join(scratch, "main");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  writeInstall(root, ext(1));
  const git = (args: readonly string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(root);
}

async function startDaemon(root: string): Promise<void> {
  const env = childEnv(runtime);
  const child = spawn(process.execPath, ["--import", TSX, CLI, "daemon", root], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  daemons.push(child);
  const { socketPathFor } = await import("../../src/core/daemon/paths.js");
  const socket = socketPathFor(worktreeIdFor(root), env);
  await until(`the daemon of ${root}`, SETTLE_MS, async () => {
    const answer = await ping(socket, 1_000);
    return answer?.phase === "ready" ? answer : null;
  });
}

/** Status once nothing is pending past revision `after` and `accept` holds. */
const settle = (root: string, what: string, accept: (s: StatusSnapshot) => boolean, after = -1) =>
  until(what, SETTLE_MS, async () => {
    const s = readStatus(root);
    if (!s.available) throw new Error(`status unavailable: ${s.message}`);
    const quiet =
      s.revision > after &&
      s.runnerPartPending !== true &&
      s.counts.pending + s.testFilesWithoutChecks.pending + s.testFilesWithoutChecks.unknown === 0;
    if (quiet && accept(s)) return s;
    const { revision, counts, knownFailures, daemonNotes } = s;
    throw new Error(JSON.stringify({ revision, counts, knownFailures, daemonNotes }));
  });

const runs = (root: string) =>
  readRuns(join(root, ".git/squeal/store.sqlite"), worktreeIdFor(root));

describe("node:test under a daemon: an install bump re-runs what reaches the package (003-33)", () => {
  it("re-runs and fails exactly the files that reach ext", SLOW, async () => {
    const root = createRepo();
    await startDaemon(root);
    const checks = 2 * TEST_FILES.length;
    const baseline = await settle(root, "the baseline", (s) => s.counts.current === checks);
    expect(baseline.knownFailures).toEqual([]);
    expect(
      runs(root)
        .flatMap((r) => r.testFiles)
        .sort(),
    ).toEqual([...TEST_FILES].sort());

    const from = runs(root).length;
    writeInstall(root, ext(2));
    const bumped = await settle(
      root,
      "the install bump",
      (s) => s.knownFailures.length > 0 && s.counts.current === checks,
      baseline.revision,
    );
    expect(
      runs(root)
        .slice(from)
        .flatMap((r) => r.testFiles)
        .sort(),
      // Each new fail is re-run once (task 001-171).
    ).toEqual([...REACHING, ...REACHING].sort());
    expect([...new Set(bumped.knownFailures.map((f) => f.check.testPath))].sort()).toEqual(
      REACHING,
    );
  });
});
