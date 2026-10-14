/*
 * Task 001-362 probe: a daemon start's store work (`openDaemon`'s serving
 * open, then `#register`'s write) beside the busy-store test's two long
 * writers, repeated; every failure prints SQLite's extended code and the
 * step. Run as
 * `node --import tsx probe-store.ts <dir> <holdMs> <restMs> <starts>`.
 * Touches only `<dir>`.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { isStoreOpenFailure, openStore, storePaths } from "../../../../../src/core/store/index.js";
import type { AbsolutePath, WorktreeId } from "../../../../../src/core/types/index.js";

const [dir, hold, rest, starts] = process.argv.slice(2);
if (dir === undefined || hold === undefined || rest === undefined || starts === undefined) {
  throw new Error("usage: probe-store.ts <dir> <holdMs> <restMs> <starts>");
}
const commonDir = dir as AbsolutePath;
const created = openStore(commonDir);
if (isStoreOpenFailure(created)) throw new Error(JSON.stringify(created));
created.close();
const database = storePaths(commonDir).database;
const writer = join(import.meta.dirname, "../../../../../test/daemon/long-writer.ts");
const writers = [0, 1].map(() =>
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", writer, database, hold, rest], {
    stdio: ["ignore", "ignore", "inherit"],
  }),
);
await new Promise((done) => setTimeout(done, 1_000));

const id = "probe" as WorktreeId;
let failures = 0;
for (let start = 1; start <= Number(starts); start++) {
  let step = "open";
  const began = Date.now();
  try {
    const store = openStore(commonDir, { checkIntegrity: true, busyTimeoutMs: 120_000 });
    if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
    try {
      step = "register";
      store.transaction(() => {
        const existing = store.worktrees.get(id);
        store.worktrees.lastDaemon(id);
        store.testFileKeys.releaseRunning(id);
        store.meta.delete(`daemon-exit:${id}`);
        store.worktrees.upsert({
          id,
          root: commonDir,
          commonDir,
          isMain: true,
          registeredAt: existing?.registeredAt ?? (Date.now() as never),
          daemon: null,
        });
      });
    } finally {
      store.close();
    }
  } catch (error) {
    failures++;
    const e = error as { errcode?: number; errstr?: string; message?: string };
    console.log(
      `start ${start}: ${step} failed after ${Date.now() - began} ms: errcode ${e.errcode} (${e.errstr}) ${e.message}`,
    );
  }
}
console.log(`${failures} of ${starts} starts failed`);
for (const w of writers) w.kill("SIGTERM");
