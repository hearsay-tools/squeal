import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StatusResult } from "../../src/core/types/status.js";
import { observeBuildInputs } from "../helpers/build-inputs.js";

/*
 * Row 025-28: runs one Node process with the work counter preloaded
 * (`work-counter.mjs`) and reads what it counted. A count does not change with
 * machine speed, so a limit on it holds on any machine.
 */

const COUNTER = join(import.meta.dirname, "work-counter.mjs");
// The counter runs in child processes; stat it here so an edit to it re-keys the test.
observeBuildInputs([COUNTER]);

/** What one call did: SQL statements and sync file calls, in total and by statement or call. */
export interface Work {
  readonly sql: number;
  readonly files: number;
  readonly bySql: Readonly<Record<string, number>>;
  readonly byFile: Readonly<Record<string, number>>;
  /** Processes that wrote counts: the call's own and any it started with the counter. */
  readonly processes: number;
}

export interface CountedRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly work: Work;
}

/** A call that has not ended by then is a hang, not slowness: no count asserts time. */
const HANG_MS = 30_000;

/**
 * Runs `node <args>` in `cwd` with exactly `env` plus the counter, stdin
 * piped, and sums the counts of every process that wrote them.
 */
export function runCounted(
  args: readonly string[],
  stdin: string,
  env: Readonly<Record<string, string>>,
  cwd: string,
): Promise<CountedRun> {
  const dir = mkdtempSync("/tmp/sq-work-");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...env, NODE_OPTIONS: `--import=${COUNTER}`, SQUEAL_WORK_COUNTS: dir },
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), HANG_MS);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        work: readWork(dir),
      });
    });
    child.stdin.end(stdin);
  });
}

function readWork(dir: string): Work {
  const bySql: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const counts = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      sql: Record<string, number>;
      fs: Record<string, number>;
    };
    for (const [key, n] of Object.entries(counts.sql)) bySql[key] = (bySql[key] ?? 0) + n;
    for (const [key, n] of Object.entries(counts.fs)) byFile[key] = (byFile[key] ?? 0) + n;
  }
  const sum = (table: Record<string, number>) => Object.values(table).reduce((a, b) => a + b, 0);
  return { sql: sum(bySql), files: sum(byFile), bySql, byFile, processes: files.length };
}

/** `table`'s entries, most first, one per line, for a failure message. */
export function listed(table: Readonly<Record<string, number>>): string {
  return Object.entries(table)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([key, n]) => `  ${n} × ${key}`)
    .join("\n");
}

/**
 * Review 025-wave6 S1: `squeal status --json` shows the complexity count
 * ended: the daemon answered, every included file is counted
 * (`code.pending` 0), and at least `files` are included. A store with no
 * count yet reads as 0 files of 0, so the floor keeps it from passing.
 */
export function countEnded(status: StatusResult, files: number): boolean {
  if (!status.available || status.code === undefined) return false;
  return status.code.pending === 0 && status.code.files >= files;
}
