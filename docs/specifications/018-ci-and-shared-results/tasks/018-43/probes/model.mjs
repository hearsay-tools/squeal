// Throwaway (row 018-43). MODELLED, not recorded: the run's parts with the evidence the fixed
// `ci record` takes for causes A and B of `research/left-out-files.md`, added where that shard's
// own test files observed the path and its evidence lacks it. The value is the blob at the
// parts' commit, which the research found every reading process saw.
// usage: node model.mjs <parts root> <checkout at the parts' commit> <out root>
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, checkout, out] = process.argv.slice(2);
// Cause A: files a spawn names in its arguments (the research's four); cause B: shard 5's mock.
const ARGUMENTS = [
  "packages/cezar/scripts/pi-retry-degraded-service.mjs",
  "packages/cezar/scripts/pi-project-skills.mjs",
  "packages/cezar/scripts/pi-default-tools.mjs",
  "sgconfig.yml",
];
const UNLINKED = { "squeal-parts-shard-5": ["packages/cezar/scripts/mock-cursor-print.mjs"] };
const blob = (path) =>
  execFileSync("git", ["rev-parse", `HEAD:${path}`], { cwd: checkout }).toString().trim();

for (const dir of readdirSync(root).filter((d) => d.startsWith("squeal-parts-shard-")).sort()) {
  mkdirSync(join(out, dir), { recursive: true });
  for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith(".json"))) {
    const part = JSON.parse(readFileSync(join(root, dir, name), "utf8"));
    const observed = new Set(part.testFiles.flatMap((f) => f.observed?.paths ?? []));
    const added = [];
    for (const path of [...ARGUMENTS, ...(UNLINKED[dir] ?? [])]) {
      if (!observed.has(path) || Object.hasOwn(part.evidence, path)) continue;
      part.evidence[path] = blob(path);
      added.push(path);
    }
    writeFileSync(join(out, dir, name), JSON.stringify(part));
    console.log(`${dir}\t${name}\tadded: ${added.join(", ") || "none"}`);
  }
}
