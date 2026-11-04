// Throwaway probe for 019-37 (lessons P11). Not product code. No daemon, no test run, no write.
// Squeal's own seed of the stat cache and `differingPaths` on a clone, against `HEAD`:
//   pnpm exec tsx <this file> <squeal worktree> <clone> [old]
// `old` gives the view no stored blobs, as before 019-37; on cezarion at 10e7a5782 it prints
// `differing: [ 'packages/mobile/android/gradlew.bat' ]` on a clean tree, and `[]` without `old`.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const wt = resolve(process.argv[2] ?? ".");
const root = resolve(process.argv[3] ?? ".");
const old = process.argv[4] === "old";
const { StatCache } = await import(`${wt}/src/core/hash/stat-cache.ts`);
const { seedStatCache } = await import(`${wt}/src/core/hash/hasher.ts`);
const { committedBlobs } = await import(`${wt}/src/core/commit/tree.ts`);
const { differingPaths } = await import(`${wt}/src/core/commit/compute.ts`);
const { storedBlobs } = await import(`${wt}/src/core/commit/stored.ts`);
const { checkIgnored } = await import(`${wt}/src/core/watcher/git.ts`);

const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const paths = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const cache = new StatCache();
console.log("seed", await seedStatCache(cache, root, paths, { objectFormat: "sha1" }));
const view = {
  hashOf: (path: string) => cache.hashOf(path),
  paths: () => cache.paths(),
  ignoredAmong: (all: string[]) => checkIgnored(root, all),
  storedBlobs: async (all: string[]) => (old ? new Map() : storedBlobs(root, all)),
};
const differing = await differingPaths(view, await committedBlobs(root, "HEAD"));
console.log("git status:", JSON.stringify(git(["status", "--porcelain"])));
console.log("differing:", [...differing]);
