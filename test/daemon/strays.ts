import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inject } from "vitest";

/*
 * Daemons Squeal's own tests start run from a build under this worktree's
 * `node_modules/.cache/squeal-test/` (lessons, defect 29; task 001-138).
 * Each Vitest run builds under its own run directory there, so the global
 * teardown (`test/global-teardown.ts`) finds what its own tests left running
 * and never touches another run's daemons in the same worktree.
 */

const repoRoot = resolve(import.meta.dirname, "../..");

/** Every test build of this worktree, of every run. */
export const TEST_CACHE = join(repoRoot, "node_modules/.cache/squeal-test");

declare module "vitest" {
  interface ProvidedContext {
    /** This run's directory under `TEST_CACHE`, from `test/global-teardown.ts`. */
    squealTestRun: string;
  }
}

/**
 * A new directory for one build under this run's directory, its test file
 * recorded beside it (`<id>.file`) so the global teardown can name the file
 * that leaked a daemon after the build itself is gone.
 */
export function testBuildDir(testFile: string | undefined, runDir = runDirectory()): string {
  const id = randomUUID();
  const dir = join(runDir, id);
  mkdirSync(dir, { recursive: true });
  if (testFile !== undefined) writeFileSync(join(runDir, `${id}.file`), testFile);
  return dir;
}

/** The run's directory; `TEST_CACHE` itself when Vitest runs without the global setup. */
function runDirectory(): string {
  try {
    return inject("squealTestRun") ?? TEST_CACHE;
  } catch {
    return TEST_CACHE;
  }
}

/** The test file that built under `dir`, from `testBuildDir`, or `null` when none is recorded. */
export function ownerOf(runDir: string, args: string): string | null {
  const id = entryUnder(runDir, args);
  if (id === "") return null;
  try {
    return readFileSync(join(runDir, `${id}.file`), "utf8");
  } catch {
    return null;
  }
}

/** The name of the entry of `dir` that the command line `args` runs from; empty when none. */
export function entryUnder(dir: string, args: string): string {
  const at = args.indexOf(`${dir}/`);
  return at === -1 ? "" : (args.slice(at + dir.length + 1).split("/")[0] ?? "");
}

export interface Stray {
  readonly pid: number;
  /** The command line. */
  readonly args: string;
}

/** Processes other than this one whose command line contains every one of `needles`. */
export function findProcesses(...needles: readonly string[]): Stray[] {
  const out = execFileSync("ps", ["-A", "-ww", "-o", "pid=", "-o", "args="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const found: Stray[] = [];
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    const args = match[2] ?? "";
    if (pid === process.pid || !needles.every((needle) => args.includes(needle))) continue;
    found.push({ pid, args });
  }
  return found;
}

/** Sends SIGTERM, then SIGKILL to what is still alive after `graceMs`; resolves once all are gone. */
export async function killProcesses(strays: readonly Stray[], graceMs = 5_000): Promise<void> {
  for (const { pid } of strays) signal(pid, "SIGTERM");
  let alive = await survivors(strays, graceMs);
  for (const { pid } of alive) signal(pid, "SIGKILL");
  alive = await survivors(alive, 5_000);
  if (alive.length > 0) throw new Error(`still alive after SIGKILL: ${pidsOf(alive)}`);
}

async function survivors(strays: readonly Stray[], waitMs: number): Promise<Stray[]> {
  const deadline = Date.now() + waitMs;
  let alive = strays.filter(({ pid }) => isAlive(pid));
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 50));
    alive = alive.filter(({ pid }) => isAlive(pid));
  }
  return alive;
}

function pidsOf(strays: readonly Stray[]): string {
  return strays.map(({ pid }) => pid).join(", ");
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

/** True while `pid` runs; a zombie, dead but not reaped, counts as gone. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}
