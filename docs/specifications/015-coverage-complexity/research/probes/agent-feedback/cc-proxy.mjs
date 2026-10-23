// Throwaway probe for 015-03 (agent-feedback.md, question 4). Read-only on git.
// For each of the last N commits: the product functions (src/**) whose lines the
// commit touched, their McCabe CC before and after, and which would cross a CRAP
// threshold of 30 under a fixed coverage assumption.
// Usage: TS_DIR=<dir with typescript 5.x in node_modules> node cc-proxy.mjs <repo> [N] > out.json
// The repository's own typescript is 7.x, whose package has no parser API.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = path.resolve(process.argv[2] ?? '.');
const n = Number(process.argv[3] ?? 100);
const require = createRequire(path.join(process.env.TS_DIR ?? repo, 'package.json'));
const ts = require('typescript');

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
const show = (rev, file) => {
  try { return git('show', `${rev}:${file}`); } catch { return null; }
};
const isProduct = (f) => /^src\/.*\.(ts|mts|js|mjs)$/.test(f) && !f.endsWith('.d.ts');
const isTest = (f) => /^test\//.test(f) || /\.test\.(ts|mts|js|mjs)$/.test(f);

const FN = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
]);
const BRANCH = new Set([
  ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.CatchClause,
]);
const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function nameOf(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.name && (ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) return node.name.text;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && p.name && 'text' in p.name) return p.name.text;
  if (p && ts.isPropertyDeclaration(p) && p.name && 'text' in p.name) return p.name.text;
  if (p && ts.isCallExpression(p)) {
    const callee = p.expression.getText().slice(0, 30);
    return `${callee}(cb)`;
  }
  return '<anon>';
}

// Functions with their CC (each function counts its own body only) and line span.
function functions(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const seen = new Map();
  function visit(node, chain, fn) {
    let here = fn;
    let nextChain = chain;
    if (ts.isClassDeclaration(node) && node.name) nextChain = [...chain, node.name.text];
    if (FN.has(node.kind)) {
      const base = [...chain, nameOf(node)].join('.');
      const k = seen.get(base) ?? 0;
      seen.set(base, k + 1);
      const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const body = node.getText(sf).replace(/\s+/g, ' ');
      here = { id: k ? `${base}#${k}` : base, name: nameOf(node), start, end, cc: 1, body };
      out.push(here);
      nextChain = [...chain, nameOf(node)];
    } else if (fn) {
      if (BRANCH.has(node.kind)) fn.cc++;
      if (ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)) fn.cc++;
    }
    ts.forEachChild(node, (c) => visit(c, nextChain, here));
  }
  visit(sf, [], null);
  return out;
}

// Innermost function containing a line.
function owner(fns, line) {
  let best = null;
  for (const f of fns) if (f.start <= line && line <= f.end && (!best || f.end - f.start < best.end - best.start)) best = f;
  return best;
}

function hunks(parent, commit, file) {
  const diff = git('diff', '-U0', '--no-color', parent, commit, '--', file);
  const oldLines = [];
  const newLines = [];
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [os, oc, ns, nc] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    for (let i = 0; i < oc; i++) oldLines.push(os + i);
    for (let i = 0; i < nc; i++) newLines.push(ns + i);
  }
  return { oldLines, newLines };
}

const crapAt = (cc, cov) => (cov >= 0.95 ? cc : cc * cc * (1 - cov) ** 3 + cc);
const COVS = [0, 0.5, 0.8, 1];

// STANDING=1: CC of every src/ function at HEAD (the known failures a per-function check would seed).
if (process.env.STANDING) {
  const files = git('ls-files', 'src').trim().split('\n').filter(isProduct);
  const texts = files.map((f) => [f, readFileSync(path.join(repo, f), 'utf8')]);
  const t1 = process.hrtime.bigint();
  const fns = texts.flatMap(([f, text]) => functions(f, text).map((x) => ({ file: f, ...x })));
  const parseMs = Number(process.hrtime.bigint() - t1) / 1e6;
  const bytes = texts.reduce((n, [, t]) => n + t.length, 0);
  const counts = Object.fromEntries([5, 10, 12, 15, 25, 30].map((t) => [`ccAtLeast${t}`, fns.filter((x) => x.cc >= t).length]));
  console.log(JSON.stringify({ files: files.length, functions: fns.length, ...counts,
    filesWithCcAtLeast12: new Set(fns.filter((x) => x.cc >= 12).map((x) => x.file)).size,
    parseAndCcMs: Math.round(parseMs), bytes, load: readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ') }, null, 2));
  process.exit(0);
}

const commits = git('log', `-${n}`, '--format=%H%x09%P%x09%s').trim().split('\n').map((l) => {
  const [h, p, s] = l.split('\t');
  return { h, parent: p.split(' ')[0], s };
});

const rows = [];
const t0 = process.hrtime.bigint();
let parsedFiles = 0;
for (const { h, parent, s } of commits) {
  const files = git('diff', '--name-only', '--no-renames', parent, h).trim().split('\n').filter(Boolean);
  const product = files.filter(isProduct);
  const row = { commit: h.slice(0, 9), subject: s.slice(0, 70), files: files.length, productFiles: product.length,
    testFiles: files.filter(isTest).length, changed: [], removed: [] };
  for (const f of product) {
    const after = show(h, f);
    const before = show(parent, f);
    const fa = after ? functions(f, after) : [];
    const fb = before ? functions(f, before) : [];
    parsedFiles += (after ? 1 : 0) + (before ? 1 : 0);
    const byId = new Map(fb.map((x) => [x.id, x]));
    const afterIds = new Set(fa.map((x) => x.id));
    const { oldLines, newLines } = hunks(parent, h, f);
    const touched = new Map();
    for (const l of newLines) {
      const o = owner(fa, l);
      if (o) touched.set(o.id, o);
    }
    for (const l of oldLines) {
      const o = owner(fb, l);
      if (o && afterIds.has(o.id)) touched.set(o.id, fa.find((x) => x.id === o.id));
    }
    for (const fn of touched.values()) {
      const old = byId.get(fn.id);
      row.changed.push({ file: f, fn: fn.id, name: fn.name, body: fn.body, ccBefore: old ? old.cc : null, ccAfter: fn.cc });
    }
    for (const g of fb) if (!afterIds.has(g.id)) row.removed.push({ file: f, fn: g.id, name: g.name, body: g.body, cc: g.cc });
  }
  // Identity across edits: an added function whose body or bare name matches one removed in the same commit.
  for (const c of row.changed.filter((x) => x.ccBefore === null)) {
    if (row.removed.some((r) => r.body === c.body)) c.identity = 'moved-or-renamed, same body';
    else if (row.removed.some((r) => r.name === c.name && r.name !== '<anon>' && !r.name.endsWith('(cb)'))) c.identity = 'same name, other place or edited';
  }
  for (const c of row.changed) delete c.body;
  rows.push(row);
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

// Aggregates.
const productCommits = rows.filter((r) => r.productFiles > 0);
const perCommit = productCommits.map((r) => r.changed.length).sort((a, b) => a - b);
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
const all = rows.flatMap((r) => r.changed.map((c) => ({ ...c, commit: r.commit })));
const ccs = all.map((c) => c.ccAfter).sort((a, b) => a - b);
const crossings = {};
for (const cov of COVS) {
  const cross = all.filter((c) => crapAt(c.ccAfter, cov) >= 30 && (c.ccBefore === null || crapAt(c.ccBefore, cov) < 30));
  const above = all.filter((c) => crapAt(c.ccAfter, cov) >= 30);
  crossings[`cov${cov * 100}`] = {
    changedFunctionsAtOrAbove30: above.length,
    commitsWithOneAtOrAbove: new Set(above.map((c) => c.commit)).size,
    crossings: cross.length,
    commitsWithACrossing: new Set(cross.map((c) => c.commit)).size,
    examples: cross.slice(0, 6).map((c) => `${c.commit} ${c.file} ${c.fn} ${c.ccBefore}->${c.ccAfter}`),
  };
}
const ccRose = all.filter((c) => c.ccBefore !== null && c.ccAfter > c.ccBefore).length;
const ccSame = all.filter((c) => c.ccBefore !== null && c.ccAfter === c.ccBefore).length;
const ccFell = all.filter((c) => c.ccBefore !== null && c.ccAfter < c.ccBefore).length;
const added = all.filter((c) => c.ccBefore === null).length;
const identity = {
  removedFunctions: rows.reduce((n, r) => n + r.removed.length, 0),
  addedMatchingARemovedBody: all.filter((c) => c.identity === 'moved-or-renamed, same body').length,
  addedMatchingARemovedName: all.filter((c) => c.identity === 'same name, other place or edited').length,
  anonymousOrCallbackIds: all.filter((c) => /<anon>|\(cb\)/.test(c.fn)).length,
};

console.log(JSON.stringify({
  repoHead: git('rev-parse', '--short=9', 'HEAD').trim(),
  commits: rows.length,
  commitsTouchingProduct: productCommits.length,
  changedFunctionsTotal: all.length,
  changedPerProductCommit: { p50: pct(perCommit, 0.5), p90: pct(perCommit, 0.9), max: perCommit.at(-1) },
  ccOfChangedFunctions: { p50: pct(ccs, 0.5), p90: pct(ccs, 0.9), max: ccs.at(-1), atLeast5: ccs.filter((x) => x >= 5).length, atLeast10: ccs.filter((x) => x >= 10).length },
  ccDirection: { added, rose: ccRose, same: ccSame, fell: ccFell },
  identity,
  crossings,
  parse: { files: parsedFiles, ms: Math.round(ms) },
  functions: all.map(({ identity: id, ...c }) => (id ? { ...c, identity: id } : c)),
  perCommit: rows.map((r) => ({ commit: r.commit, subject: r.subject, productFiles: r.productFiles, testFiles: r.testFiles,
    changed: r.changed.length, maxCc: r.changed.reduce((m, c) => Math.max(m, c.ccAfter), 0) })),
}, null, 2));
