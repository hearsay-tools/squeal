// Row 011-183: the time of one reconcileNow("watch") pass of the change feed on a tree, read-only:
// a backend that watches nothing, and the tracked paths of `git ls-files` as the stat cache.
// Usage, from the repository root: npx tsx docs/specifications/011-core/tasks/011-183/probe/cost.ts <worktree root>
import { execFileSync } from "node:child_process";
import { createChangeFeed } from "../../../../../../src/core/watcher/index.js";

const root = process.argv[2] as string;
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 })
  .toString()
  .split("\0")
  .filter(Boolean);
const backend = {
  name: "chokidar" as const,
  watch: async () => ({ update: async () => {}, close: async () => {} }),
};
let paths = 0;
const feed = createChangeFeed({
  root: root as never,
  backend,
  onBatch: (batch) => {
    paths = batch.paths.length;
  },
  onError: (error) => console.log("error", error.message),
  trackedPaths: () => tracked,
  timings: { reconcileIntervalMs: 3_600_000 },
});
let t = performance.now();
await feed.start();
const start = performance.now() - t;
const times: number[] = [];
for (let i = 0; i < 5; i++) {
  t = performance.now();
  await feed.reconcile("watch");
  times.push(Math.round(performance.now() - t));
}
await feed.close();
const sorted = [...times].sort((a, b) => a - b);
console.log(
  `${root}: ${tracked.length} tracked, ${paths} candidates; start ${Math.round(start)} ms; passes ${times.join(", ")} ms (median ${sorted[2]}); excluded ${feed.spec?.excluded.length ?? "?"}; load ${execFileSync("cut", ["-d ", "-f1-3", "/proc/loadavg"]).toString().trim()}`,
);
process.exit(0);
