// Throwaway (018-01). Per-file times from GitHub Actions job logs that
// `gh run view <run> --job <id> --log` printed. Vitest's file lines read
// `✓ test/x.test.ts (N tests) 337ms`; gh prints colour codes as the text
// `^[[..m`, which this strips first. Output: JSON {file: ms}, summed over
// the logs given (a file appears in one shard).
// Usage: node file-times.mjs <log>... > times.json
import { readFileSync } from "node:fs";

const times = {};
const line = /^\s*[✓×❯] (\S+\.test\.ts) \((\d+) tests?[^)]*\)\s+([\d.]+)(ms|s)\b/;
for (const path of process.argv.slice(2)) {
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const text = raw
      .split("\t")
      .slice(2)
      .join("\t")
      .replace(/\^\[\[[0-9;]*m/g, "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/^\S+Z /, "");
    const m = line.exec(text);
    if (m === null) continue;
    const ms = Number(m[3]) * (m[4] === "s" ? 1000 : 1);
    times[m[1]] = (times[m[1]] ?? 0) + ms;
  }
}
process.stdout.write(`${JSON.stringify(times, null, 1)}\n`);
