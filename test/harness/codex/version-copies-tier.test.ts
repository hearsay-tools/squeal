import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { shellWord } from "../../../src/core/text.js";
import { ping, waitFor } from "../../daemon/helpers.js";
import { runBundle, runtimeDir } from "../bundle-helpers.js";
import {
  A,
  B,
  type Built,
  buildVersions,
  type CodexMachine,
  codexMachine,
} from "./cache-fixture.js";
import { codexRecorded, sessionOf } from "./helpers.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73, `research/plugin-cache-cleanup.md`
 * Recommendation, test 4; gh-70): a daemon that SessionStart spawned on A
 * runs from A's copy, so a tier it starts after Codex deleted A's cache
 * directory loads A's recorder and reporter copies in every child: no
 * `ERR_MODULE_NOT_FOUND`, and no failed result.
 */

const SLOW = { timeout: 240_000 } as const;
const WAIT = "status --wait 60000";

let built: Built;
beforeAll(async () => {
  built = await buildVersions([A, B]);
}, 120_000);
afterAll(() => built.cleanup());

let m: CodexMachine;
let socket = "";
/** Stops the daemon the hook spawned, found through its socket, whatever the test reached. */
afterEach(async () => {
  const pid = (await ping(socket, 1_000))?.pid;
  if (pid !== undefined) process.kill(pid, "SIGKILL");
  m.cleanup();
});

/** A node:test repository whose test spawns a child Node, as gh-70's tier did. */
function repository(): string {
  const root = join(m.dir, "repo");
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "kept", private: true, type: "module" })}\n`,
    "squeal.config.json": `${JSON.stringify({
      nodeTest: [{ name: "unit", node: process.execPath, argv: [], include: ["test/*.test.mjs"] }],
    })}\n`,
    "src/value.mjs": "export const value = 1;\n",
    "test/a.test.mjs": [
      `import assert from "node:assert/strict";`,
      `import { execFileSync } from "node:child_process";`,
      `import { test } from "node:test";`,
      `import { value } from "../src/value.mjs";`,
      `test("a child Node starts under the recorder", () => {`,
      `  assert.equal(execFileSync(process.execPath, ["-e", "process.stdout.write('ok')"], { encoding: "utf8" }), "ok");`,
      `  assert.equal(value, 1);`,
      `});`,
      "",
    ].join("\n"),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"]);
  return realpathSync(root);
}

const revisionOf = (status: string) => Number(/^Revision: (\d+)/.exec(status)?.[1]);

describe("a tier on A's daemon after A's cache directory is deleted (005-73)", () => {
  it("test 4: loads A's recorder copy in a child spawned after the deletion", SLOW, async () => {
    m = codexMachine(built);
    const root = repository();
    const runtime = runtimeDir();
    socket = join(runtime, `squeal-${worktreeIdFor(root)}.sock`);
    const plugin = m.install(A);
    const input = codexRecorded("exec", "session-start", root, sessionOf("exec", "session-start"));
    const env = {
      XDG_RUNTIME_DIR: runtime,
      PLUGIN_ROOT: plugin,
      PLUGIN_DATA: m.data,
      HOME: m.home,
      PATH: m.path,
    };
    const start = await runBundle("session-start", input, env, join(plugin, "dist"));
    expect(start).toMatchObject({ code: 0, stderr: "" });
    const launcher = shellWord(join(m.data, "bin", "squeal"));
    const shell = (command: string) =>
      m.shell(command, root, { XDG_RUNTIME_DIR: runtime, CODEX_SESSION_ID: "019a0000-0000" });
    // The baseline checkpoint: a `status --wait` before any edit returns on quiet without
    // holding for it, which CI's runner reached first (cand/0.1.247, run 39668199233).
    await waitFor(async () => (await ping(socket, 500))?.phase === "ready", 60_000, "daemon ready");
    const baseline = shell(`${launcher} run --all --wait 60000`);
    expect(baseline.status, `${baseline.stdout}${baseline.stderr}`).toBe(0);
    const first = shell(`${launcher} ${WAIT}`);
    expect(first.stdout, first.stderr).toMatch(/\nKnown failures: 0; all 1 test file current\n/);
    const answer = await ping(socket, 1_000);
    const daemon = answer?.pid;
    expect(answer?.squealVersion).toBe(A);
    const args = execFileSync("ps", ["-o", "args=", "-p", String(daemon)], { encoding: "utf8" });
    expect(args).toContain(` ${join(m.data, "versions", A, "dist", "cli", "squeal.mjs")} daemon `);

    m.install(B);
    m.remove(A);
    writeFileSync(
      join(root, "src", "value.mjs"),
      "// edited after the upgrade\nexport const value = 1;\n",
    );
    const after = shell(`${launcher} ${WAIT}`);
    expect(after.stdout, after.stderr).toMatch(/\nKnown failures: 0; all 1 test file current\n/);
    // The edit's revision: the tier ran after the deletion.
    expect(revisionOf(after.stdout)).toBeGreaterThan(revisionOf(first.stdout));
    expect(after.stdout).not.toContain("ERR_MODULE_NOT_FOUND");
    expect((await ping(socket, 1_000))?.pid).toBe(daemon);
  });
});
