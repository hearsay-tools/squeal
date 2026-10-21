// Probe for 011-85, question 5: a static estimate of how many test files key
// by the whole fingerprint on their own (011 C11 cases 1 and 2), walking
// relative imports only. Reads files; starts nothing. Not Vite's graph: an
// estimate, tagged as such in design.md.
// Usage: node opaque-count.mjs <repo-root>
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const OPAQUE = /^(node:)?(child_process|worker_threads|cluster|module)$/;
const SPEC = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
const HAND = /require\.resolve|createRequire|import\.meta\.resolve/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "fixtures" || entry.name === "e2e") continue;
      walk(path, out);
    } else if (entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function resolveRelative(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts"), `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const facts = new Map();
function factsOf(file) {
  let f = facts.get(file);
  if (f) return f;
  const text = readFileSync(file, "utf8");
  f = { relatives: [], builtins: new Set(), hand: HAND.test(text) };
  for (const m of text.matchAll(SPEC)) {
    // Type-only imports leave no runtime edge in Vite's graph.
    if (/^(import|export)\s+type\s/.test(m[0])) continue;
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (spec.startsWith(".")) {
      const target = resolveRelative(file, spec);
      if (target) f.relatives.push(target);
    } else if (OPAQUE.test(spec)) f.builtins.add(spec.replace(/^node:/, ""));
  }
  facts.set(file, f);
  return f;
}

const tests = [...walk(join(root, "test")), ...walk(join(root, "src"))];
// Per project file that imports an opaque builtin itself: how many test closures hold it.
const direct = new Map();
let opaque = 0;
let builtin = 0;
let hand = 0;
for (const test of tests) {
  const seen = new Set([test]);
  const queue = [test];
  let reach = false;
  let byHand = false;
  while (queue.length > 0) {
    const file = queue.pop();
    const f = factsOf(file);
    if (f.builtins.size > 0) {
      reach = true;
      direct.set(file, (direct.get(file) ?? 0) + 1);
    }
    if (f.hand) byHand = true;
    for (const next of f.relatives) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  if (reach) builtin++;
  if (byHand) hand++;
  if (reach || byHand) opaque++;
}
const hubs = [...direct].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => [relative(root, f), n]);
console.log(JSON.stringify({ testFiles: tests.length, caseOneBuiltin: builtin, caseTwoHandResolution: hand, eitherCase: opaque, hubs }));
