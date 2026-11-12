import { describe, expect, it, onTestFinished } from "vitest";
import type { CliIo } from "../../../src/cli/main.js";
import { reachCommand } from "../../../src/cli/reach.js";
import { startDaemon } from "../../../src/core/daemon/daemon.js";
import type { ReachReport } from "../../../src/core/reach/report-types.js";
import { createFixtureRepo, readNotes, SLOW, waitFor, withStore } from "../../daemon/helpers.js";
import { runMissingConfig } from "../../helpers/baseline.js";

/*
 * Row 020-36 (spec 020 D12.6 as amended 2026-11-12; `research/issue-194-gaps.md`
 * G6): a node:test file that runs a script only in a process it starts, under
 * a real daemon with `coverage.children`. Before the row the module recorder
 * reached no child, so the daemon named the file as loading nothing beyond
 * itself and `squeal reach` found no test file for the script; now the child's
 * load is in the file's observed set, and reach names the route.
 */

const lines = (...text: string[]) => `${text.join("\n")}\n`;

const SCRIPT = "nt/scripts/release.mjs";
const TEST = "nt/test/e2e/release.test.mjs";

const FILES = {
  "squeal.config.json": runMissingConfig(
    JSON.stringify({
      coverage: { enabled: true, children: true },
      nodeTest: [{ name: "package", cwd: "nt", include: ["test/e2e/*.test.mjs"], argv: [] }],
    }),
  ),
  "nt/package.json": `${JSON.stringify({ name: "nt", private: true, type: "module" })}\n`,
  [SCRIPT]: lines(
    'import { pathToFileURL } from "node:url";',
    "export function publish(names) {",
    "  const done = [];",
    "  for (const name of names) {",
    '    if (name.startsWith("@private/")) continue;',
    '    done.push("would publish " + name);',
    "  }",
    "  return done;",
    "}",
    "if (import.meta.url === pathToFileURL(process.argv[1]).href) {",
    "  console.log(JSON.stringify(publish(process.argv.slice(2))));",
    "}",
  ),
  [TEST]: lines(
    'import assert from "node:assert/strict";',
    'import { execFileSync } from "node:child_process";',
    'import test from "node:test";',
    'test("release publishes public packages", () => {',
    '  const out = execFileSync(process.execPath, ["scripts/release.mjs", "a", "@private/b"], {',
    '    encoding: "utf8",',
    "  });",
    '  assert.deepEqual(JSON.parse(out), ["would publish a"]);',
    "});",
  ),
};

async function reach(root: string, env: NodeJS.ProcessEnv, path: string) {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    cwd: root,
    env,
  };
  expect(await reachCommand([path, "--json"], io)).toBe(0);
  return JSON.parse(stdout) as ReachReport;
}

describe("a node:test child's load under a real daemon (row 020-36, G6)", SLOW, () => {
  it("is recorded, so reach names the test file as reaching the script", async () => {
    const repo = createFixtureRepo({ files: FILES });
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;

    const ran = () =>
      withStore(repo, (store) => {
        const row = store.testFileKeys
          .list(repo.worktreeId)
          .find((r) => r.testFile.project === "package");
        return row !== undefined && row.key !== null && row.pending === null;
      });
    await waitFor(ran, 120_000, "the node:test file run");

    expect(readNotes(repo).filter((text) => text.includes("loaded nothing beyond"))).toEqual([]);
    const named = (await reach(repo.root, repo.env, SCRIPT)).named?.[0];
    expect(named).toMatchObject({ path: SCRIPT, testFiles: 1 });
    expect(named?.routes.map((r) => [r.kind, r.tests.map((t) => t.path)])).toEqual([
      ["child process", [TEST]],
    ]);
  });
});
