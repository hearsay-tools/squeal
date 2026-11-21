import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { stopCommand } from "../../src/cli/stop.js";
import { readGroups, runGroupsFile, writeGroups } from "../../src/core/daemon/run-groups.js";
import { type ProcessEntry, statOf } from "../../src/core/daemon/terminate.js";
import { resolveCommonDir } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { git } from "../hash/git-repo.js";

/*
 * Row 023-36 (spec 023 D4 step 11, T3), done-when 2: `squeal stop` ends a
 * process group a `--run` run started that its daemon's record still lists,
 * names it, and clears the record; a process outside the group survives.
 */

const saved = { ...process.env };
let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync("/tmp/sq-"));
  process.env.XDG_RUNTIME_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

function repo(): AbsolutePath {
  const root = join(dir, "repo");
  mkdirSync(root);
  git(root, ["init", "-q"]);
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, ["add", "a.txt"]);
  git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
  return root as AbsolutePath;
}

/** A sleeping node in a session and group of its own, with an empty env. */
async function detached(): Promise<ProcessEntry> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
    env: {},
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("no pid");
  onTestFinished(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // gone
    }
  });
  for (let i = 0; i < 100; i++) {
    const found = statOf(pid);
    if (found !== null && found.pgrp === pid) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} did not start`);
}

describe.runIf(process.platform === "linux")("squeal stop and a --run run's groups", () => {
  it("ends a recorded group still alive, names it, and leaves a process outside it", async () => {
    const root = repo();
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) throw new Error("no common dir");
    const file = runGroupsFile(commonDir, root);
    const inside = await detached();
    const outside = await detached();
    writeGroups(file, [{ pgid: inside.pid, start: inside.start, runId: "run-7" }]);

    const out: string[] = [];
    const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => out.push(text) };
    const code = await stopCommand([root], io);

    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toContain(
      `Ended 1 process in a process group a \`--run\` run started: ${inside.pid} `,
    );
    expect(text).toContain("(run run-7)");
    expect(statOf(inside.pid)).toBeNull();
    expect(statOf(outside.pid)?.start).toBe(outside.start);
    expect(readGroups(file)).toEqual([]);
  });
});
