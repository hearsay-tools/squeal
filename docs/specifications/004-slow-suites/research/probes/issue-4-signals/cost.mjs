// Throwaway: plan-time cost of each signal for one edit over cezarion's slow web specs, read from disk
// as a daemon would (research/issue-4-signals.md, question 2). Reads files only; writes nothing.
// Usage: node cost.mjs <cezarion worktree> <edited path> [iterations]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { has, tokensOf } from "./tokens.mjs";

const [root, edited, n = "50"] = process.argv.slice(2);
const E2E = "packages/web/e2e";
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
const EXTS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];
const read = (p) => {
  try {
    return readFileSync(join(root, p), "utf8");
  } catch {
    return null;
  }
};
function local(path, text) {
  const out = [];
  for (const m of text.matchAll(IMPORT)) {
    const base = normalize(join(dirname(path), m[1]));
    for (const e of EXTS) if (read(base + e) !== null) { out.push(base + e); break; }
  }
  return out;
}

/** Spec side: each spec with its ./ helpers. A daemon could cache this per spec hash; `cold` reads it each time. */
function specSide() {
  const specs = readdirSync(join(root, E2E)).filter((f) => f.endsWith(".e2e.ts"));
  return specs.map((s) => {
    const own = read(`${E2E}/${s}`);
    return [s, [own, ...local(`${E2E}/${s}`, own).filter((p) => p.startsWith(`${E2E}/`)).map(read)].join("\n")];
  });
}
/** Change side: the edited file and the local modules it imports (b2), its tokens matched against each spec. */
function rank(side) {
  const text = read(edited);
  const src = [text, ...local(edited, text).map(read)].join("\n");
  const tokens = [...tokensOf(src)];
  const hits = new Map(tokens.map((t) => [t, side.filter(([, s]) => has(s, t)).map(([n]) => n)]));
  const kept = tokens.filter((t) => hits.get(t).length > 0 && hits.get(t).length <= 20);
  return side.map(([n]) => [n, kept.filter((t) => hits.get(t).includes(n)).length]).filter(([, k]) => k > 0);
}

const it = Number(n);
const time = (f) => {
  const t = [];
  for (let i = 0; i < it; i++) {
    const t0 = performance.now();
    f();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return { medianMs: +t[t.length >> 1].toFixed(2), p90Ms: +t[Math.floor(t.length * 0.9)].toFixed(2) };
};
const cached = specSide();
const bytes = cached.reduce((s, [, t]) => s + t.length, 0);
const closureSet = new Set(cached.map(([n]) => `${E2E}/${n}`));
console.log(
  JSON.stringify(
    {
      edited,
      specs: cached.length,
      specSideBytes: bytes,
      evidence: rank(cached),
      tokensCold: time(() => rank(specSide())),
      tokensWarm: time(() => rank(cached)),
      // (a) is a membership test per file against a closure already in memory; (c) a glob match.
      closureLookup: time(() => cached.forEach(([s]) => closureSet.has(`${E2E}/${s}`))),
    },
    null,
    1,
  ),
);
