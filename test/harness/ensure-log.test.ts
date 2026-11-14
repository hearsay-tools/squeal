import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDaemonProcess } from "../../src/core/daemon/ensure.js";
import { daemonLogFor } from "../../src/core/store/paths.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fakeRepo } from "../status/helpers.js";
import { tempDir } from "../store/helpers.js";

/*
 * Row 021-32 at the spawn: the daemon's stdout and stderr are the
 * worktree's log, what it writes outside its own log lines included, and
 * the spawn returns without waiting for it; with no log to open, it spawns
 * with `ignore` as before.
 */

const saved = { ...process.env };
let runtimeDir: string;

beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  delete process.env.SQUEAL_CLI;
});

afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * A stand-in daemon: a line on stdout and on stderr at once, a marker that
 * it started, and a last line after `lateMs`, so the spawn's return is seen
 * before the daemon ends.
 */
function standIn(lateMs: number): { cli: AbsolutePath; started: string } {
  const dir = tempDir("squeal-log-cli-");
  const started = join(dir, "started");
  const cli = join(dir, "cli.mjs") as AbsolutePath;
  writeFileSync(
    cli,
    `import { writeFileSync } from "node:fs";
process.stdout.write("out line\\n");
process.stderr.write("err line\\n");
writeFileSync(${JSON.stringify(started)}, "");
setTimeout(() => process.stderr.write("late line\\n"), ${lateMs});
`,
  );
  return { cli, started };
}

async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  for (let waited = 0; waited < ms && !check(); waited += 20) await sleep(20);
  return check();
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

describe("ensureDaemonProcess and the daemon log (row 021-32)", () => {
  it("gives the daemon the worktree's log as stdout and stderr, without waiting for it", async () => {
    const repo = fakeRepo();
    const { cli } = standIn(1_500);
    const path = daemonLogFor(repo.commonDir as AbsolutePath, repo.mainId);
    writeFileSync(join(repo.main, ".keep"), "");
    mkdirSync(join(repo.commonDir, "squeal", "logs"), { recursive: true });
    writeFileSync(path, "an earlier daemon's line\n");

    const daemon = await ensureDaemonProcess(repo.main as AbsolutePath, {
      cli,
      socketTimeoutMs: 100,
    });
    expect(daemon.result).toBe("spawned");
    // Returned while the daemon runs: its last line is still 1.5 s away.
    expect(daemon.ended()).toBe(false);
    expect(read(path)).not.toContain("late line");

    expect(await until(() => read(path).includes("late line"))).toBe(true);
    const lines = read(path).trimEnd().split("\n");
    // Appended after what was there; stdout and stderr both land, in either order.
    expect(lines[0]).toBe("an earlier daemon's line");
    expect(lines.slice(1, 3).sort()).toEqual(["err line", "out line"]);
    expect(lines[3]).toBe("late line");
  });

  it("still spawns, with `ignore`, when the logs directory cannot be made", async () => {
    const repo = fakeRepo();
    const { cli, started } = standIn(0);
    mkdirSync(join(repo.commonDir, "squeal"), { recursive: true });
    writeFileSync(join(repo.commonDir, "squeal", "logs"), "a file where the directory goes");

    const daemon = await ensureDaemonProcess(repo.main as AbsolutePath, {
      cli,
      socketTimeoutMs: 100,
    });
    expect(daemon.result).toBe("spawned");
    expect(await until(() => existsSync(started))).toBe(true);
    expect(readFileSync(join(repo.commonDir, "squeal", "logs"), "utf8")).toBe(
      "a file where the directory goes",
    );
  });
});
