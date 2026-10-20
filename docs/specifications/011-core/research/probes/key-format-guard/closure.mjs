// Throwaway probe (011-35). Reads files through `git show`, runs no product code.
// For each KEY_FORMAT_VERSION raise window, computes the relative-import
// closure of a set of key and acceptance entry points at both ends of the
// window, and reports which changed files fall inside it: whether a guard over
// that closure, instead of all of src/, would have fired.
//
//   node closure.mjs [--types]   (--types also follows `import type` edges)
import { execFileSync } from "node:child_process";
import { posix } from "node:path";

const TOP = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) =>
  execFileSync("git", args, { cwd: TOP, encoding: "utf8", maxBuffer: 1 << 28 });
const followTypes = process.argv.includes("--types");

// Same windows as raises.sh: release carrying N-1 .. first version commit carrying N.
const WINDOWS = [
  [10, "squeal--v0.1.168", "6c9fed9e"],
  [11, "squeal--v0.1.199", "a6c50b6e"],
  [12, "squeal--v0.1.215", "35abdccc"],
  [13, "2639208a", "87d7ced6"],
  [14, "squeal--v0.1.222", "05958848"],
  [15, "squeal--v0.1.223", "8515e737"],
  [16, "squeal--v0.1.224", "70759ddf"],
  [17, "squeal--v0.1.225", "d3014a3e"],
];

const RUNNERS = [
  "src/runners/vitest/index.ts",
  "src/runners/vitest/adapter.ts",
  "src/runners/node-test/adapter.ts",
  "src/runners/pytest/adapter.ts",
  "src/runners/observe/index.ts",
];

// Entry points of the validity path, two ways.
const ENTRIES = {
  // As the code stands: the acceptance decisions live inside Ledger and recordTier.
  "as-is": [
    "src/core/keys/index.ts",
    "src/core/scheduler/keying.ts",
    "src/core/scheduler/records.ts",
    "src/core/scheduler/stability.ts",
    "src/core/scheduler/store-results.ts",
    "src/core/store/repos/results.ts",
    "src/core/store/schema.ts",
    "src/core/state/inherited.ts",
    "src/core/scheduler/ledger.ts",
    "src/core/scheduler/tiers.ts",
    ...RUNNERS,
  ],
  // Were Ledger.probe and recordTier's store decision their own modules: no ledger.ts, tiers.ts.
  "split": [
    "src/core/keys/index.ts",
    "src/core/scheduler/keying.ts",
    "src/core/scheduler/records.ts",
    "src/core/scheduler/stability.ts",
    "src/core/scheduler/store-results.ts",
    "src/core/store/repos/results.ts",
    "src/core/store/schema.ts",
    "src/core/state/inherited.ts",
    ...RUNNERS,
  ],
};

const IMPORT =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["'](\.\.?\/[^"']+)["']|(?:^|\n)\s*import\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;

function allTypes(clause) {
  const m = clause.match(/^\{([\s\S]*)\}$/);
  if (!m) return false;
  const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith("type "));
}

function closure(sha, entries) {
  const files = new Set(git("ls-tree", "-r", "--name-only", sha, "src").split("\n"));
  const seen = new Set();
  const stack = entries.filter((e) => files.has(e));
  while (stack.length > 0) {
    const path = stack.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.(ts|mjs|cjs)$/.test(path)) continue;
    const text = git("show", `${sha}:${path}`);
    for (const m of text.matchAll(IMPORT)) {
      const typeOnly = m[2] !== undefined || (m[3] !== undefined && allTypes(m[3].trim()));
      if (typeOnly && !followTypes) continue;
      const spec = m[4] ?? m[5];
      let target = posix.join(posix.dirname(path), spec).replace(/\.js$/, ".ts");
      if (!files.has(target)) {
        if (files.has(target.replace(/\.ts$/, ".cjs"))) target = target.replace(/\.ts$/, ".cjs");
        else if (files.has(`${target}/index.ts`)) target = `${target}/index.ts`;
        else if (files.has(spec.replace(/^\.\//, posix.dirname(path) + "/"))) target = posix.join(posix.dirname(path), spec);
        else continue;
      }
      stack.push(target);
    }
  }
  return seen;
}

const guarded = (p) =>
  /^src\//.test(p) &&
  !/^src\/core\/keys\/key-format\.ts$|^src\/runners\/[^/]+\/version\.ts$/.test(p) &&
  (!/^src\/(cli|core\/status|core\/delivery|harness)\//.test(p) ||
    /^src\/cli\/(index|main|daemon)\.ts$|^src\/harness\/((claude-code|codex|pi|opencode)\/)?build\.ts$/.test(p));

console.log(`type-only imports followed: ${followTypes}`);
for (const [name, entries] of Object.entries(ENTRIES)) {
  console.log(`\n### entries: ${name}`);
  for (const [v, a, b] of WINDOWS) {
    const inside = new Set([...closure(a, entries), ...closure(b, entries)]);
    const changed = git("diff", "--name-only", a, b).split("\n").filter(guarded);
    const hit = changed.filter((p) => inside.has(p));
    console.log(
      `raise ${v - 1}->${v}: closure ${inside.size} files; changed guarded ${changed.length}; inside ${hit.length}: ${hit.join(" ") || "-"}`,
    );
  }
}
