import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { groupRequests } from "../../src/core/daemon/run-group.js";
import { squealRepo } from "../harness/helpers.js";
import { lastRelease, ROOT } from "../keys/validity/trees.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-302: a `run-group` answer gains `holder`, which a CLI of the
 * previous release does not know. That CLI, read from the last release's
 * tag, reads the new daemon's pending answer as before: no verdict at its
 * deadline, exit 3, no error.
 */

const dirs: string[] = [];
afterEach(() => {
  closeFakeDaemons();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The last release's CLI bundle, written to a temporary directory. */
function releasedCli(): string {
  const dir = mkdtempSync("/tmp/sq-release-cli-");
  dirs.push(dir);
  const bundle = join(dir, "squeal.mjs");
  const ref = `${lastRelease()}:plugins/claude-code/dist/cli/squeal.mjs`;
  writeFileSync(bundle, execFileSync("git", ["-C", ROOT, "show", ref], { maxBuffer: 64 << 20 }));
  return bundle;
}

/**
 * `node <cli> <args>` in `cwd`, as the shipped launchers run it (no
 * ExperimentalWarning for `node:sqlite`, which Node 22 prints): its exit
 * code and output; never rejects on a non-zero exit.
 */
function runCli(cli: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", cli, ...args],
      { cwd, env, timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({ code: error === null ? 0 : (error.code as number | null), stdout, stderr }),
    );
  });
}

describe("the previous release's CLI and a pending request's holder (row 011-302)", () => {
  it("reads the new pending answer without error: no verdict, exit 3", async () => {
    const r = squealRepo();
    writeFileSync(
      join(r.root, "squeal.config.json"),
      JSON.stringify({
        checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
      }),
    );
    const runtimeDir = mkdtempSync("/tmp/sq-");
    dirs.push(runtimeDir);
    const env: NodeJS.ProcessEnv = { ...process.env, XDG_RUNTIME_DIR: runtimeDir };
    for (const name of ["PLUGIN_ROOT", "PLUGIN_DATA", "CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA"]) {
      delete env[name];
    }
    // The new daemon's answers: the lock's holder, and the main thread's step beside it.
    const groups = groupRequests(
      (_group, held) => {
        held({ kind: "scheduler", operation: "applying revision 412", since: Date.now() - 48_000 });
        return new Promise(() => {});
      },
      8,
      () => ({ operation: "keying lint checks", since: Date.now() - 5_000 }),
    );
    const first = groups.start("e2e");
    const status = groups.status(first.requestId);
    expect(status?.holder).toMatchObject({
      kind: "scheduler",
      step: { operation: "keying lint checks" },
    });
    if (status === null) throw new Error("the request is not remembered");
    await fakeDaemon(socketPathFor(r.worktreeId, env), {
      "run-group": [{ ...first }],
      "run-group-status": [{ ...status }],
    });

    const result = await runCli(releasedCli(), ["run", "e2e", "--wait", "500"], r.root, env);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(
      new RegExp(
        `^Group e2e has no verdict: the deadline passed before the daemon took request ${first.requestId}; `,
      ),
    );
    expect(result.code).toBe(3);
  });
});
