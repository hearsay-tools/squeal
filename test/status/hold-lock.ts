import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";

/**
 * Issues 7 and 8 (row 011-01): a second process holding one SQLite lock on
 * the store for `holdMs`, as `research/probes/issue-7/hold.mjs` does.
 * `immediate` is a daemon's write lock (D8), which WAL readers share;
 * `exclusive-locking` is the file's exclusive lock, which blocks them.
 */
export type HeldLock = "immediate" | "exclusive-locking";

const HOLDER = `
import { DatabaseSync } from "node:sqlite";
const [db, mode, holdMs] = process.argv.slice(1);
const conn = new DatabaseSync(db);
conn.exec("PRAGMA busy_timeout = 30000");
if (mode === "exclusive-locking") conn.exec("PRAGMA locking_mode = EXCLUSIVE");
conn.exec(mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN EXCLUSIVE");
conn.exec("INSERT INTO meta (key, value) VALUES ('held-lock', 'held')");
process.stdout.write("held\\n");
setTimeout(() => {
  conn.exec("ROLLBACK");
  conn.close();
  process.stdout.write("released\\n");
}, Number(holdMs));
`;

export interface LockHolder {
  readonly child: ChildProcess;
  /** Resolves once the holder has rolled back and exited. */
  readonly released: Promise<void>;
}

/** Resolves once the child holds the lock. */
export async function holdLock(
  database: string,
  mode: HeldLock,
  holdMs: number,
): Promise<LockHolder> {
  const child = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      HOLDER,
      database,
      mode,
      String(holdMs),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const released = once(child, "exit").then(() => undefined);
  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`lock holder exited ${code} before holding`)));
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("held")) resolve();
    });
  });
  return { child, released };
}
