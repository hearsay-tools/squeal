import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { CliIo } from "../../src/cli/main.js";
import { startCommand } from "../../src/cli/start.js";
import type { DaemonSuite, FixtureRepo } from "./helpers.js";

/*
 * `squeal start` in the test's own process, for `start-handoff` and
 * `start-register` (rows 011-34, 011-110, 011-111).
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

/** A CLI that only appends its arguments to `log`, one JSON line for each daemon spawned. */
export function spawnLog(suite: DaemonSuite): { cli: string; spawns: () => string[][] } {
  const base = `/tmp/sq-start-${randomUUID()}`;
  const log = `${base}.log`;
  writeFileSync(
    `${base}.mjs`,
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
  );
  suite.cleanup(() => rmSync(`${base}.mjs`, { force: true }));
  suite.cleanup(() => rmSync(log, { force: true }));
  const spawns = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
  return { cli: `${base}.mjs`, spawns };
}
