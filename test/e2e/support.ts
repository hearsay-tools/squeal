import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const POLL_MS = 150;

/** Whether Node module resolution from `dir` could reach a `node_modules` above it. */
export function hasNodeModulesAbove(dir: string): boolean {
  for (let at = dirname(dir); ; at = dirname(at)) {
    if (existsSync(join(at, "node_modules"))) return true;
    if (dirname(at) === at) return false;
  }
}

/** Pids of daemons started from this plugin copy's CLI. */
export function daemonPids(plugin: string): number[] {
  const ps = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  const cli = join(plugin, "dist/cli/squeal.mjs");
  return ps
    .split("\n")
    .filter((line) => line.includes(`${cli} daemon`))
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

/** Polls `probe` until it returns non-null; a thrown probe counts as null. Bounded by `ms`. */
export async function until<T>(
  what: string,
  ms: number,
  probe: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown = null;
  for (;;) {
    const value = await probe().catch((error: unknown) => {
      last = error;
      return null;
    });
    if (value !== null) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${ms} ms waiting for ${what}${last ? `: ${String(last)}` : ""}`,
      );
    }
    await sleep(POLL_MS);
  }
}

/**
 * Appends one JSON line to the file `SQUEAL_E2E_METRICS` names, when set:
 * hook latencies and edit-to-settled times for reports. Settle times include
 * the status polling interval.
 */
export function metric(entry: object): void {
  const file = process.env.SQUEAL_E2E_METRICS;
  if (file !== undefined && file !== "") appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

export interface RunRow {
  readonly revision: number;
  readonly testFiles: readonly string[];
  readonly end: string | null;
}

/** Runs of one worktree, oldest first, read from the store file with no Squeal code. */
export function readRuns(storePath: string, worktreeId: string): RunRow[] {
  const db = new DatabaseSync(storePath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT revision, test_files, end_state FROM runs WHERE worktree_id = ? ORDER BY started_at, rowid",
      )
      .all(worktreeId) as { revision: number; test_files: string; end_state: string | null }[];
    return rows.map((r) => ({
      revision: r.revision,
      testFiles: (JSON.parse(r.test_files) as { path: string }[]).map((f) => f.path),
      end: r.end_state,
    }));
  } finally {
    db.close();
  }
}
