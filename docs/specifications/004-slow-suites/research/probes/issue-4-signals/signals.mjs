// Throwaway, read only: ranks cezarion's slow web specs after one edit by each candidate signal of
// hearsay-tools/squeal#4, for research/issue-4-signals.md. Not product code.
// Usage: node signals.mjs <cezarion clone> <closures.json from store-closures.mjs> <ci-durations.json> > out.json
// Reads cezarion only through `git show`, `git ls-tree` and `git diff` at fixed revisions.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { has, tokensOf } from "./tokens.mjs";

const [C, closuresFile, durationsFile] = process.argv.slice(2);
const E2E = "packages/web/e2e";
const git = (...args) => execFileSync("git", ["-C", C, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const show = (rev, path) => {
  try {
    return git("show", `${rev}:${path}`);
  } catch {
    return null;
  }
};
const closures = JSON.parse(readFileSync(closuresFile, "utf8"));
const ci = JSON.parse(readFileSync(durationsFile, "utf8"));

// Edits: a real commit's change to one path, ranked against the specs as they were before it.
// Synthetic: a comment appended at a revision, as an agent's mid-task edit would be.
const EDITS = [
  {
    id: "E1 markdown.tsx (#1076)",
    rev: "979d96c91^",
    commit: "979d96c91",
    path: "packages/web/src/routes/task-thread/markdown.tsx",
    wanted: ["artifact-project-links.e2e.ts"],
    why: "failed in CI run 38795107753 after this edit",
  },
  {
    id: "E2 thread-scroll.ts (a source a spec imports; synthetic)",
    rev: "d88c8c1d3",
    path: "packages/web/src/routes/task-thread/thread-scroll.ts",
    wanted: ["progressive-history.e2e.ts", "thread-scroll.e2e.ts"],
    why: "progressive-history imports it; thread-scroll is the spec named for it",
  },
  {
    id: "E3 github-fixture.ts (shared helper, #1044)",
    rev: "c04150895^",
    commit: "c04150895",
    path: "packages/web/e2e/github-fixture.ts",
    wanted: "callers:clickGitHubTab",
    why: "the edit changed clickGitHubTab; its callers exercise it",
  },
  {
    id: "E4 build-e2e.sh (config, #1097)",
    rev: "a805cb41f^",
    commit: "a805cb41f",
    path: ".ai/scripts/build-e2e.sh",
    wanted: [],
    why: "the build of every spec's bundle: no spec is more relevant than another",
  },
  {
    id: "E5 accessibility.css (#966)",
    rev: "7077c7a7a^",
    commit: "7077c7a7a",
    path: "packages/web/src/styles/accessibility.css",
    wanted: ["good-css.e2e.ts", "task-thread.e2e.ts"],
    why: "the specs the author extended in the same commit",
  },
  {
    id: "E6 diff.tsx (the issue comment's second case; synthetic)",
    rev: "d88c8c1d3",
    path: "packages/web/src/components/diff/diff.tsx",
    wanted: [
      "commit-list.e2e.ts", "diff-scroll.e2e.ts", "git-sidebar.e2e.ts", "markdown-preview.e2e.ts",
      "repo-git-diff.e2e.ts", "review-gate.e2e.ts", "task-changes.e2e.ts", "variants-compare.e2e.ts",
    ],
    why: "the issue comment's eight specs that select data-slot=\"diff-…\" hooks",
  },
];

// Hypothetical config hint, as a maintainer would write it from cezarion's AGENTS.md (#1096, f1fb182e0)
// and the issue's comment: the two shared renderers it names. Nothing else is foreseen.
const HINTS = {
  "packages/web/src/routes/task-thread/markdown.tsx": [
    "artifact-project-links.e2e.ts", "assistant-line-breaks.e2e.ts", "chat-code-fence.e2e.ts",
    "composer.e2e.ts", "task-files.e2e.ts", "task-thread.e2e.ts",
  ],
  "packages/web/src/components/diff/**": [
    "commit-list.e2e.ts", "diff-scroll.e2e.ts", "git-sidebar.e2e.ts", "markdown-preview.e2e.ts",
    "repo-git-diff.e2e.ts", "review-gate.e2e.ts", "task-changes.e2e.ts", "variants-compare.e2e.ts",
  ],
};
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`);

// Relative imports, resolved to repo paths that exist at `rev`.
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];
function imports(rev, path, text) {
  const out = [];
  for (const m of text.matchAll(IMPORT)) {
    const base = normalize(join(dirname(path), m[1]));
    for (const e of EXTS) if (exists(rev, base + e)) { out.push(base + e); break; }
  }
  return out;
}
const treeCache = new Map();
function exists(rev, path) {
  if (!treeCache.has(rev)) treeCache.set(rev, new Set(git("ls-tree", "-r", "--name-only", rev).split("\n")));
  return treeCache.get(rev).has(path);
}
const textCache = new Map();
const text = (rev, path) => {
  const k = `${rev}:${path}`;
  if (!textCache.has(k)) textCache.set(k, show(rev, path) ?? "");
  return textCache.get(k);
};
function importClosure(rev, spec) {
  const seen = new Set();
  const stack = [spec];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p) || !/\.(ts|tsx|mjs|js)$/.test(p)) continue;
    seen.add(p);
    for (const q of imports(rev, p, text(rev, p))) stack.push(q);
  }
  seen.delete(spec);
  return seen;
}

function hunkText(commit, path) {
  return git("diff", `${commit}^`, commit, "--unified=0", "--", path)
    .split("\n")
    .filter((l) => /^[+-][^+-]/.test(l))
    .map((l) => l.slice(1))
    .join("\n");
}

function rankBy(specs, today, score) {
  // Higher score first; a spec with no evidence keeps today's order (the issue's criterion 2).
  return [...specs].sort((a, b) => score(b) - score(a) || today.indexOf(a) - today.indexOf(b));
}
const positions = (order, wanted) => wanted.map((w) => order.indexOf(w) + 1);
const secondsBefore = (order, w) => order.slice(0, order.indexOf(w)).reduce((s, n) => s + (ci[n] ?? 0), 0) / 1000;

const results = [];
for (const edit of EDITS) {
  const t0 = performance.now();
  const specs = git("ls-tree", "--name-only", edit.rev, `${E2E}/`).split("\n").filter((p) => p.endsWith(".e2e.ts")).map((p) => p.slice(E2E.length + 1));
  const specText = new Map(specs.map((s) => [s, text(edit.rev, `${E2E}/${s}`)]));
  const wanted = edit.wanted === "callers:clickGitHubTab" ? specs.filter((s) => /clickGitHubTab\(/.test(specText.get(s))) : edit.wanted;
  // Today: class (direct: the runner's one-hop importers), then shortest stored duration, unknown last, then path.
  const oneHop = new Set(specs.filter((s) => imports(edit.rev, `${E2E}/${s}`, specText.get(s)).includes(edit.path)));
  const byDuration = [...specs].sort((a, b) => (ci[a] ?? Infinity) - (ci[b] ?? Infinity) || (a < b ? -1 : 1));
  const today = [...byDuration].sort((a, b) => (oneHop.has(b) ? 1 : 0) - (oneHop.has(a) ? 1 : 0));
  const tToday = performance.now();

  // (a) stored closure: the store's closure_paths (static imports plus declared inputs), read 2026-10-17.
  const inStored = (s) => (closures[`${E2E}/${s}`]?.paths.includes(edit.path) ? 1 : 0);
  const storedHits = specs.filter((s) => inStored(s)).length;
  const aStored = rankBy(specs, today, inStored);
  // (a') the static-import part alone: the spec's own import closure holds the path.
  const tA = performance.now();
  const closureOf = new Map(specs.map((s) => [s, importClosure(edit.rev, `${E2E}/${s}`)]));
  const inImports = (s) => (closureOf.get(s).has(edit.path) ? 1 : 0);
  const aImports = rankBy(specs, today, inImports);
  const tA2 = performance.now();

  // (b) diff tokens. Spec side: the spec and its local ./ helpers (issue-4-ranking.md finding 5).
  const specSide = new Map(
    specs.map((s) => {
      const own = specText.get(s);
      const helpers = imports(edit.rev, `${E2E}/${s}`, own).filter((p) => p.startsWith(`${E2E}/`));
      return [s, [own, ...helpers.map((h) => text(edit.rev, h))].join("\n")];
    }),
  );
  const after = edit.commit ?? edit.rev;
  const changedFile = text(after, edit.path);
  const sources = {
    // b1: only the changed lines (a synthetic comment edit has none worth a token).
    b1: edit.commit ? hunkText(edit.commit, edit.path) : "",
    // b2: the whole changed file and the local modules it imports (AGENTS.md's manual method).
    b2: [changedFile, ...imports(after, edit.path, changedFile).map((p) => text(after, p))].join("\n"),
  };
  const tokenRuns = {};
  for (const [name, src] of Object.entries(sources)) {
    const all = [...tokensOf(src)];
    // A token half the suite selects ranks nothing; drop tokens matched by more than 20 of the specs.
    const hits = new Map(all.map((tok) => [tok, specs.filter((s) => has(specSide.get(s), tok))]));
    const kept = all.filter((tok) => hits.get(tok).length > 0 && hits.get(tok).length <= 20);
    const score = (s) => kept.filter((tok) => hits.get(tok).includes(s)).length;
    const order = rankBy(specs, today, score);
    tokenRuns[name] = {
      tokens: all.length,
      matchedTokens: kept,
      droppedAsCommon: all.filter((tok) => hits.get(tok).length > 20),
      specsWithEvidence: specs.filter((s) => score(s) > 0).length,
      wantedAt: positions(order, wanted),
      wantedScore: wanted.map(score),
      first5: order.slice(0, 5),
    };
  }
  const tB = performance.now();

  // (c) config hint.
  const hinted = new Set(Object.entries(HINTS).filter(([g]) => globRe(g).test(edit.path)).flatMap(([, s]) => s));
  const cHint = rankBy(specs, today, (s) => (hinted.has(s) ? 1 : 0));

  results.push({
    edit: edit.id,
    rev: edit.rev,
    path: edit.path,
    why: edit.why,
    specs: specs.length,
    wanted,
    today: { wantedAt: positions(today, wanted), oneHopImporters: [...oneHop], secondsBeforeFirstWanted: wanted.length ? Math.min(...wanted.map((w) => secondsBefore(today, w))) : null, first5: today.slice(0, 5) },
    aStoredClosure: { specsWhoseStoredClosureHoldsPath: storedHits, specsWithStoredClosure: specs.filter((s) => closures[`${E2E}/${s}`]).length, wantedAt: positions(aStored, wanted) },
    aImportClosure: { specsWithEvidence: specs.filter((s) => inImports(s)).length, wantedAt: positions(aImports, wanted), first5: aImports.slice(0, 5), ms: +(tA2 - tA).toFixed(1) },
    bTokens: { ...tokenRuns, ms: +(tB - tA2).toFixed(1) },
    cHint: { specsWithEvidence: hinted.size, wantedAt: positions(cHint, wanted), first5: cHint.slice(0, 5) },
    todayMs: +(tToday - t0).toFixed(1),
  });
}
console.log(JSON.stringify(results, null, 1));
