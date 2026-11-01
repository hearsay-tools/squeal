// Throwaway (018-04). Per-file times and shard membership from cezarion's
// GitHub job logs (`gh run view --job <id> --log`). Its Vitest prints
// `✓ <project label> <path from the project root> (N tests) 337ms`, coloured;
// gh prints the colour codes as the text `^[[..m`. The project label maps to
// the project root, so paths come out repository-relative.
// Output: JSON { "<repo path>": { ms, shard, project } }.
// Usage: node file-times.mjs <shard name>=<log> ... > times.json
import { readFileSync } from "node:fs";

const roots = {
  server: "packages/cezar",
  web: "packages/web",
  contract: "packages/contract",
  "api-client": "packages/api-client",
  e2e: "packages/web/e2e",
};
const line = /^\s*[✓×❯↓]\s+(server|web|contract|api-client|e2e)\s+(\S+\.(?:test|e2e)\.tsx?) \((\d+) tests?[^)]*\)\s+([\d.]+)(ms|s)\b/;
const out = {};
for (const arg of process.argv.slice(2)) {
  const [shard, path] = arg.split("=");
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
    const file = `${roots[m[1]]}/${m[2]}`;
    const ms = Number(m[4]) * (m[5] === "s" ? 1000 : 1);
    out[file] = { ms: (out[file]?.ms ?? 0) + ms, shard, project: m[1] };
  }
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
