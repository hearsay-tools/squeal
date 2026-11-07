// Row 015-111: point every import of test/scheduler/helpers.ts at the module that now defines
// each name. Rewrites import statements only; run `biome check --write` on the changed files after,
// so the new lines take their sorted place. Usage: node rewrite-imports.mjs [repo]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

const repo = process.argv[2] ?? process.cwd();
const HELPERS = "test/scheduler/helpers.ts";
const HOME = {
  SLOW: "cleanup",
  cleanUp: "cleanup",
  traceRepo: "cleanup",
  ALL_TEST_FILES: "repo",
  ref: "repo",
  createRepo: "repo",
  addWorktree: "repo",
  openRepoStore: "repo",
  RecordedRun: "recording-runner",
  FailingCall: "recording-runner",
  RecordingRunner: "recording-runner",
  Harness: "vitest-harness",
  HarnessOptions: "vitest-harness",
  openHarness: "vitest-harness",
};
const ORDER = ["cleanup", "repo", "recording-runner", "vitest-harness", "node-test-harness"];
// A file that hands `nodeTest` to the harness (a key outside a policy) needs the node:test one.
const passesNodeTest = (text) =>
  text.split("\n").some((line) => /\bnodeTest(TierSize)?:/.test(line) && !/policy/i.test(line));

const files = execFileSync("git", ["-C", repo, "ls-files", "src", "test"], { encoding: "utf8" })
  .split("\n")
  .filter((p) => p.endsWith(".ts") && p !== HELPERS);
const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+(["'])([^"']+)\3;?/g;
let changed = 0;
for (const file of files) {
  const text = readFileSync(join(repo, file), "utf8");
  const nodeTest = passesNodeTest(text);
  const next = text.replace(IMPORT, (whole, typeOnly, list, quote, spec) => {
    if (!spec.startsWith(".")) return whole;
    const target = posix.normalize(posix.join(posix.dirname(file), spec.replace(/\.js$/, ".ts")));
    if (target !== HELPERS) return whole;
    const groups = new Map();
    for (const raw of list.split(",").map((s) => s.trim()).filter(Boolean)) {
      const name = raw.replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      let home = HOME[name];
      if (home === undefined) throw new Error(`${file}: ${name} has no home`);
      if (name === "openHarness" && nodeTest) home = "node-test-harness";
      groups.set(home, [...(groups.get(home) ?? []), raw]);
    }
    const prefix = spec.slice(0, spec.length - "helpers.js".length);
    return ORDER.filter((home) => groups.has(home))
      .map((home) => `import ${typeOnly ?? ""}{ ${groups.get(home).join(", ")} } from ${quote}${prefix}${home}.js${quote};`)
      .join("\n");
  });
  if (next !== text) {
    writeFileSync(join(repo, file), next);
    changed += 1;
    console.log(`${nodeTest ? "node-test " : ""}${file}`);
  }
}
console.error(`${changed} files rewritten`);
