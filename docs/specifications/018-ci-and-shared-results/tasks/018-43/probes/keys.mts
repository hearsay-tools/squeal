// Throwaway (row 018-43): keys of the results each bundle holds, compared with the first bundle's.
import { readFileSync } from "node:fs";
import { decodeBundle } from "/home/agent/projects/squeal/.ai/cezar/worktrees/37809bc6-27de-49d9-8d04-79dd3264b3f6/src/core/store/transfer-bundle.ts";
const read = (file: string) => {
  const bundle = decodeBundle(readFileSync(file));
  if (typeof bundle === "string") throw new Error(`${file}: ${bundle}`);
  return bundle;
};
const keyed = (file: string) => {
  const b = read(file);
  const keys = new Map(b.results.map((r) => [`${r.project}:${r.testPath}:${r.kind}:${r.fullName}`, r.key]));
  return { keys, files: b.testFiles.length, env: b.environments.map((e) => e.hash).sort().join(",") };
};
const [first, ...rest] = process.argv.slice(2).map(keyed);
for (const [i, other] of rest.entries()) {
  let same = 0, differ = 0, missing = 0;
  for (const [id, key] of first!.keys) {
    const k = other.keys.get(id);
    if (k === undefined) missing++; else if (k === key) same++; else differ++;
  }
  console.log(`bundle ${i + 2}: files ${other.files} vs ${first!.files}; first's results: ${same} same key, ${differ} other key, ${missing} absent; environments equal: ${other.env === first!.env}`);
}
