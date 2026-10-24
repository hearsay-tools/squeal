// Row 011-183: forces the watcher swap's interleaving through the real change feed and chokidar.
// The edit lands while the new watcher (W2) scans src/math.ts, and the old watcher's (W1) stat
// of the edit's event is slower than W2's finish. `armed` forces it; `control` edits after the swap.
// Usage, from the repository root: [WAIT_MS=33000] npx tsx docs/specifications/011-core/tasks/011-183/probe/race.ts armed|control
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2] ?? "armed";
const require = createRequire(import.meta.url);
const fsp = require("node:fs/promises") as typeof import("node:fs/promises");
const realLstat = fsp.lstat;
const realStat = fsp.stat;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let target = "";
let armed = false;
let edited = 0;
const log: string[] = [];
const t0 = performance.now();
const at = () => Math.round(performance.now() - t0);
(fsp as any).lstat = async (path: any, ...rest: any[]) => {
  if (armed && String(path) === target && edited === 0) {
    edited = performance.now();
    appendFileSync(target, "// edit during the new watcher's scan\n");
    log.push(`${at()} edit inside W2's lstat of math.ts`);
    await delay(30);
  }
  return (realLstat as any)(path, ...rest);
};
(fsp as any).stat = async (path: any, ...rest: any[]) => {
  if (armed && String(path) === target && edited !== 0) {
    log.push(`${at()} a watcher's stat of math.ts (its change listener) begins, slowed 150 ms`);
    await delay(150);
  }
  return (realStat as any)(path, ...rest);
};
syncBuiltinESMExports();

const { createChangeFeed } = await import("../../../../../../src/core/watcher/index.js");
const { chokidarBackend } = await import("../../../../../../src/core/watcher/chokidar-backend.js");

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
const parent = realpathSync(mkdtempSync(join(tmpdir(), "sq-183-race-")));
const root = join(parent, "repo");
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, ".gitignore"), "node_modules/\n");
writeFileSync(join(root, "src/math.ts"), "export const one = 1;\n");
git(root, "init", "-q", "-b", "main");
git(root, "add", "-A");
git(root, "-c", "user.email=a@b", "-c", "user.name=a", "commit", "-q", "-m", "fixture");
target = join(root, "src/math.ts");

const backend = {
  name: "traced-chokidar",
  async watch(spec: any, listener: any) {
    const sub = await chokidarBackend.watch(spec, listener);
    return {
      async update(next: any) {
        log.push(`${at()} swap begins`);
        await sub.update(next);
        log.push(`${at()} swap done: W2 ready, W1 closed`);
      },
      close: () => sub.close(),
    };
  },
};
const batches: string[][] = [];
const feed = createChangeFeed({
  root,
  backend,
  onBatch: (batch: any) => {
    const paths = batch.paths.map((p: any) => p.path);
    batches.push(paths);
    log.push(`${at()} batch ${batch.trigger} [${paths.join(",")}]`);
  },
  onError: (error: Error) => log.push(`${at()} error ${error.message}`),
  trackedPaths: () => ["src/math.ts"],
});
await feed.start();
await delay(300);
const from = batches.length;
armed = mode === "armed";
log.push(`${at()} node_modules/.vite appears (as Vitest's results cache)`);
mkdirSync(join(root, "node_modules/.vite/vitest/da39a3ee"), { recursive: true });
writeFileSync(join(root, "node_modules/.vite/vitest/da39a3ee/results.json"), "{}");
if (mode === "control") {
  await delay(400);
  appendFileSync(target, "// edit after the swap\n");
  log.push(`${at()} edit after the swap`);
}
await delay(Number(process.env.WAIT_MS ?? 3000));
const hit = batches.slice(from).some((paths) => paths.includes("src/math.ts"));
console.log(log.join("\n"));
console.log(`${mode}: ${hit ? "the edit's batch came" : "LOST: no batch for the edit within the wait"}`);
await feed.close();
rmSync(parent, { recursive: true, force: true });
process.exit(0);
