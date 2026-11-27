import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { membersOf } from "./process-groups.js";
import { scratchAt, scratchDir } from "./scratch.js";

const started: number[] = [];
afterEach(() => {
  for (const group of started.splice(0)) {
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      // Gone.
    }
  }
});

/** A detached process running `script` with `args`, the leader of its own group and session. */
function detached(script: string, args: readonly string[] = [], cwd?: string): number {
  const child = spawn(process.execPath, ["-e", script, ...args], {
    detached: true,
    stdio: "ignore",
    ...(cwd === undefined ? {} : { cwd }),
  });
  if (child.pid === undefined) throw new Error("no pid");
  started.push(child.pid);
  return child.pid;
}

/** A writer that, every millisecond, makes `<dir>/sub` again and adds a file to it, for ever. */
function writer(dir: string): number {
  return detached(
    `const fs = require("fs"); const sub = process.argv[1] + "/sub"; let n = 0;
     setInterval(() => { try { fs.mkdirSync(sub, { recursive: true }); fs.writeFileSync(sub + "/" + n++, ""); } catch {} }, 1);`,
    [dir],
  );
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let waited = 0; !check(); waited += 10) {
    if (waited > 10_000) throw new Error(`${what} not met in 10 s`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

const SLEEPER = "setInterval(() => {}, 1000)";

describe.skipIf(process.platform !== "linux")("scratch folders (row 011-431)", () => {
  // Findings G3: the old cleanups removed the folder while such a writer still ran.
  it("ends a detached writer that names the folder, then removes it", async () => {
    const scratch = scratchDir(join(tmpdir(), "squeal-scratch-"));
    const group = writer(scratch.dir);
    await until(() => existsSync(join(scratch.dir, "sub", "1")), "the writer's first files");
    // The old cleanup, whether it throws ENOTEMPTY (Node 22) or not: the writer makes the folder again.
    try {
      rmSync(scratch.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // Either way.
    }
    await until(() => existsSync(join(scratch.dir, "sub")), "the folder made again");
    scratch.remove();
    expect(membersOf([group])).toEqual([]);
    expect(existsSync(scratch.dir)).toBe(false);
  });

  it("takes a writer whose working directory is in the folder", async () => {
    const scratch = scratchDir(join(tmpdir(), "squeal-scratch-"));
    const group = detached(SLEEPER, [], scratch.dir);
    await until(() => membersOf([group]).length > 0, "the process's start");
    scratch.remove();
    expect(membersOf([group])).toEqual([]);
    expect(existsSync(scratch.dir)).toBe(false);
  });

  // Review 011-336 B1: only a group that started for the folder is signalled.
  it("leaves a group older than the folder, and one that does not name it", async () => {
    const dir = join(tmpdir(), `squeal-scratch-${randomUUID()}`);
    const older = detached(SLEEPER, [dir]);
    await until(() => membersOf([older]).length > 0, "the older process's start");
    const scratch = scratchAt(dir);
    mkdirSync(dir);
    const stranger = detached(SLEEPER, [join(tmpdir(), randomUUID())]);
    const mine = detached(SLEEPER, [join(dir, "file")]);
    await until(() => membersOf([stranger, mine]).length === 2, "the processes' start");
    scratch.remove();
    expect(membersOf([older]).map(({ pid }) => pid)).toEqual([older]);
    expect(membersOf([stranger]).map(({ pid }) => pid)).toEqual([stranger]);
    expect(membersOf([mine])).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
