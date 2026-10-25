// Row 011-204: the cost of one lstat after each read diffCandidates makes, on this repository's tracked files.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const repo = process.argv[2];
const { createFsHasher } = await import(join(repo, "src/core/hash/hasher.ts"));
const { mapConcurrent } = await import(join(repo, "src/core/fs/index.ts"));
const paths = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).trim().split("\n");
const hasher = createFsHasher(repo, "sha1");
const time = async (fn: () => Promise<unknown>) => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};
const rounds = 5;
const hashMs: number[] = [];
const statMs: number[] = [];
for (let i = 0; i < rounds; i++) {
  hashMs.push(await time(() => mapConcurrent(paths, (p: string) => hasher.hash(p))));
  statMs.push(await time(() => mapConcurrent(paths, (p: string) => hasher.stat(p))));
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const one: number[] = [];
for (let i = 0; i < 2000; i++) {
  const p = paths[i % paths.length];
  const t = performance.now();
  await hasher.stat(p);
  one.push(performance.now() - t);
}
console.log(
  JSON.stringify({
    files: paths.length,
    allHashMedianMs: +median(hashMs).toFixed(1),
    allStatMedianMs: +median(statMs).toFixed(1),
    oneStatMedianUs: +(median(one) * 1000).toFixed(1),
    load: (await import("node:fs")).readFileSync("/proc/loadavg", "utf8").split(" ")[0],
  }),
);
