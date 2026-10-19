// Builds test/fixtures/slow-rank/replay.json, the E1, E4 and E5 replays of research/issue-4-signals.md,
// from a cezarion clone read only through `git show` and `git ls-tree` (task 004-82).
// Usage: node replay-fixture.mjs <cezarion clone> > test/fixtures/slow-rank/replay.json
//
// Each edit keeps the changed file and its local imports, and every slow spec and its `./` helpers, reduced
// to the lines that carry a token the research probe's extractor finds on the changed side, plus the import
// lines. The product extractor (`src/core/slow/rank-tokens.ts`) then runs on those lines in the replay test,
// so the fixture does not decide the ranking: it only leaves out lines no token of the edit can match.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { has, tokensOf } from "../../research/probes/issue-4-signals/tokens.mjs";

const [C] = process.argv.slice(2);
const here = import.meta.dirname;
const E2E = "packages/web/e2e";
const ci = JSON.parse(readFileSync(join(here, "../../research/probes/issue-4-ranking/ci-durations.json"), "utf8"));
const git = (...args) => execFileSync("git", ["-C", C, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const show = (rev, path) => {
  try {
    return git("show", `${rev}:${path}`);
  } catch {
    return "";
  }
};

const EDITS = [
  { id: "E1", rev: "979d96c91^", after: "979d96c91", path: "packages/web/src/routes/task-thread/markdown.tsx" },
  { id: "E4", rev: "a805cb41f^", after: "a805cb41f", path: ".ai/scripts/build-e2e.sh" },
  { id: "E5", rev: "7077c7a7a^", after: "7077c7a7a", path: "packages/web/src/styles/accessibility.css" },
];

const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];
const trees = new Map();
const exists = (rev, path) => {
  if (!trees.has(rev)) trees.set(rev, new Set(git("ls-tree", "-r", "--name-only", rev).split("\n")));
  return trees.get(rev).has(path);
};
function imports(rev, path, text) {
  const out = [];
  for (const m of text.matchAll(IMPORT)) {
    const base = normalize(join(dirname(path), m[1]));
    for (const e of EXTS) if (exists(rev, base + e)) { out.push(base + e); break; }
  }
  return out;
}
const isImport = (line) => /(?:from|import)\s*\(?\s*['"]\.{1,2}\//.test(line);
const reduce = (text, keep) => text.split("\n").filter((l) => isImport(l) || keep(l)).join("\n");

const out = { source: "hearsay-tools/cezarion", generatedBy: "docs/specifications/004-slow-suites/tasks/004-82/replay-fixture.mjs", edits: [] };
for (const edit of EDITS) {
  const changedText = show(edit.after, edit.path);
  const changedSide = { [edit.path]: changedText };
  for (const p of imports(edit.after, edit.path, changedText)) changedSide[p] = show(edit.after, p);
  const tokens = [...tokensOf(Object.values(changedSide).join("\n"))];
  const keep = (line) => tokens.some((t) => has(line, t));
  const specs = git("ls-tree", "--name-only", edit.rev, `${E2E}/`).split("\n").filter((p) => p.endsWith(".e2e.ts"));
  const files = {};
  for (const [p, text] of Object.entries(changedSide)) files[p] = reduce(text, (l) => tokensOf(l).size > 0);
  for (const spec of specs) {
    const text = show(edit.rev, spec);
    files[spec] = reduce(text, keep);
    for (const helper of imports(edit.rev, spec, text).filter((h) => h.startsWith(`${E2E}/`))) {
      files[helper] ??= reduce(show(edit.rev, helper), keep);
    }
  }
  const durations = Object.fromEntries(specs.map((s) => [s, ci[s.slice(E2E.length + 1)] ?? null]));
  out.edits.push({ id: edit.id, rev: edit.rev, after: edit.after, changed: edit.path, specs, durations, files });
}
console.log(JSON.stringify(out, null, 1));
