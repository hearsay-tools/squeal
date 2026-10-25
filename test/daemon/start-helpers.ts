import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { CliIo } from "../../src/cli/main.js";
import { startCommand } from "../../src/cli/start.js";
import type { DaemonSuite, FixtureRepo } from "./helpers.js";

/*
 * `squeal start` in the test's own process, for `start-handoff`,
 * `start-register` and `start-spawned` (rows 011-34, 011-110, 011-111,
 * 011-214).
 */

/** `startCommand` in this process, spawning `cli`, with `bounds`; its code and output. */
export async function startIn(
  repo: FixtureRepo,
  bounds: Parameters<typeof startCommand>[2],
  cli: string,
) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: repo.root,
    env: repo.env,
  };
  // The CLI it spawns, and where it finds the socket: the fixture's, not this test runner's.
  const saved = process.env;
  process.env = { ...repo.env, SQUEAL_CLI: cli };
  try {
    const code = await startCommand([], io, bounds);
    return { code, stdout, stderr };
  } finally {
    process.env = saved;
  }
}

/**
 * A CLI that only appends its arguments to `log`, one JSON line for each
 * daemon spawned, and exits. With `liveMs`, each process lives that long
 * first, as a daemon still starting does (row 011-214); the test's cleanup
 * kills any left, on Linux, where `/proc` shows the pid still runs this script.
 */
export function spawnLog(
  suite: Pick<DaemonSuite, "cleanup">,
  liveMs = 0,
): { cli: string; spawns: () => string[][] } {
  const base = `/tmp/sq-start-${randomUUID()}`;
  const log = `${base}.log`;
  const pids = `${base}.pids`;
  const lives = liveMs > 0 ? `setTimeout(() => {}, ${liveMs});\n` : "";
  writeFileSync(
    `${base}.mjs`,
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(pids)}, process.pid + "\\n");\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n${lives}`,
  );
  suite.cleanup(() => rmSync(`${base}.mjs`, { force: true }));
  suite.cleanup(() => rmSync(log, { force: true }));
  suite.cleanup(() => {
    if (!existsSync(pids)) return;
    for (const pid of readFileSync(pids, "utf8").trim().split("\n")) {
      // A pid the stub left may name another process by now.
      if (!runs(Number(pid), `${base}.mjs`)) continue;
      process.kill(Number(pid), "SIGKILL");
    }
    rmSync(pids, { force: true });
  });
  const spawns = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
  return { cli: `${base}.mjs`, spawns };
}

/** Whether process `pid` runs `script`, by its `/proc` command line. */
function runs(pid: number, script: string): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").includes(script);
  } catch {
    return false;
  }
}
