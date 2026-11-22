import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * The 0.1.594 boat.dev measurement (row 023-40, `tasks/023-40e-measure.md`):
 * a second `status --at --run` call exited 13 with no output when the
 * worktree daemon's sync stayed pending, because the CLI awaited a promise
 * that only unref'd sleeps kept going. Review 0.1.595 N1 (row 023-41): a
 * real child awaits the production `askNow` at top level against a socket
 * this test serves, whose sync stays pending, then answers or never does.
 * Neither the socket nor the watchdog is in the child, so only `askNow`'s
 * own ref'd handle keeps it alive. Without `keptAlive` in `askNow`, the
 * child exits 13 with no output at its first poll.
 */

const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const MODULE = pathToFileURL(
  new URL("../../src/cli/status-at-now-ask.ts", import.meta.url).pathname,
).href;

let dir: string;

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  dir = mkdtempSync("/tmp/sq-kept-");
});

afterEach(() => {
  closeFakeDaemons();
  rmSync(dir, { recursive: true, force: true });
});

/** The daemon's answer to `sync` and `sync-status`: stored at `revision`, or pending (`null`). */
const sync = (revision: number | null): Answer => ({
  ok: true,
  type: "sync",
  requestId: "y1",
  revision,
  error: null,
});

/** A child that awaits `askNow(root, [], deadline)` at top level and prints its answer. */
function askInChild(
  root: AbsolutePath,
  deadline: number,
): Promise<{ code: number | null; stdout: string }> {
  const script = [
    `import { askNow } from ${JSON.stringify(MODULE)};`,
    `const asked = await askNow(${JSON.stringify(root)}, [], ${deadline});`,
    "console.log(JSON.stringify(asked));",
  ].join("\n");
  const child = spawn(process.execPath, ["--import", TSX, "--input-type=module", "-e", script], {
    env: { ...process.env, XDG_RUNTIME_DIR: dir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  // The watchdog stays in the parent: a leaked handle in the child is killed, never awaited.
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 30_000);
  return new Promise((resolve) => {
    child.once("exit", (code) => {
      clearTimeout(watchdog);
      resolve({ code, stdout });
    });
  });
}

/** This test's worktree root, with a stand-in daemon on its socket. */
async function servedRoot(answers: Record<string, Answer[]>): Promise<AbsolutePath> {
  const root = dir as AbsolutePath;
  await fakeDaemon(socketPathFor(worktreeIdFor(root), { XDG_RUNTIME_DIR: dir }), answers);
  return root;
}

describe("askNow on a pending sync (review 0.1.595 N1)", () => {
  it("lives through two pending polls and reads the revision the daemon then stores", async () => {
    const root = await servedRoot({
      sync: [sync(null)],
      "sync-status": [sync(null), sync(null), sync(7)],
    });
    const { code, stdout } = await askInChild(root, Number.POSITIVE_INFINITY);
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ kind: "read", revision: 7 });
  }, 60_000);

  it("lives until its deadline when the sync stays pending, then reads still setting up", async () => {
    const root = await servedRoot({ sync: [sync(null)], "sync-status": [sync(null)] });
    const { code, stdout } = await askInChild(root, Date.now() + 5_000);
    expect(code, stdout).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ kind: "setting up" });
  }, 60_000);
});
