// Throwaway probe for research/function-selection.md (row 022-07). Not product code.
// Rule A's structural comparison of one changed file: function bodies, the
// module skeleton, and whether the pre-edit coverage record entered each
// changed function. TypeScript 6.0.3's parser (classic API), from this
// repository's pnpm store; tokens without trivia, so comments, blank lines
// and line shifts compare equal.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const repo = fileURLToPath(new URL("../../../../../../", import.meta.url));
const ts = createRequire(import.meta.url)(join(repo, "node_modules/.pnpm/typescript@6.0.3/node_modules/typescript"));
export const TS_VERSION = ts.version;

const FN = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor, ts.SyntaxKind.Constructor,
]);
const kindOf = (p) => (p.endsWith(".tsx") ? ts.ScriptKind.TSX : p.endsWith(".jsx") ? ts.ScriptKind.JSX : /\.(c|m)?js$/.test(p) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
export const isScript = (p) => /\.(c|m)?(j|t)sx?$/.test(p) && !p.endsWith(".d.ts");

function nameOf(node, sf) {
  if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) return node.name.text;
  if (node.kind === ts.SyntaxKind.Constructor) return "constructor";
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isCallExpression(p)) {
    const callee = p.expression.getText(sf).slice(0, 40);
    const arg0 = p.arguments[0] && ts.isStringLiteralLike(p.arguments[0]) ? p.arguments[0].text.slice(0, 40) : "";
    return `${callee}(${arg0})`;
  }
  return "<anon>";
}
const prefix = (node) => (node.kind === ts.SyntaxKind.GetAccessor ? "get " : node.kind === ts.SyntaxKind.SetAccessor ? "set " : "");

/** Tokens of `node` without trivia; each function body below it becomes "{#}". */
function tokens(node, sf, out) {
  for (const child of node.getChildren(sf)) {
    if (child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode) continue;
    if (FN.has(node.kind) && child === node.body) { out.push("{#}"); continue; }
    if (child.getChildCount(sf) === 0) { const t = child.getText(sf); if (t) out.push(t); }
    else tokens(child, sf, out);
  }
  return out;
}

/**
 * The structure of one source text: the skeleton (module tokens with every
 * function body replaced), each function with a body by a qualified name,
 * its own body tokens (nested bodies replaced), its span and body span.
 */
export function structure(path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
  const fns = [];
  const seen = new Map();
  const visit = (node, parentName, parentIndex) => {
    let name = parentName, index = parentIndex;
    if (FN.has(node.kind) && node.body) {
      const base = `${parentName}/${prefix(node)}${nameOf(node, sf)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      name = `${base}#${n}`;
      index = fns.length;
      fns.push({
        name, parent: parentIndex, start: node.getStart(sf), end: node.end,
        bodyStart: node.body.getStart(sf), bodyEnd: node.body.end,
        own: tokens(node.body, sf, []).join(" "),
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      });
    } else if (ts.isClassLike(node) && node.name) {
      name = `${parentName}/${node.name.text}`;
    }
    ts.forEachChild(node, (c) => visit(c, name, index));
  };
  visit(sf, "", -1);
  // the skeleton: bodies replaced at the outermost function level
  const skel = [];
  const walk = (node) => {
    for (const child of node.getChildren(sf)) {
      if (child.kind >= ts.SyntaxKind.FirstJSDocNode && child.kind <= ts.SyntaxKind.LastJSDocNode) continue;
      if (FN.has(node.kind) && child === node.body) { skel.push("{#}"); continue; }
      if (child.getChildCount(sf) === 0) { const t = child.getText(sf); if (t) skel.push(t); }
      else walk(child);
    }
  };
  walk(sf);
  const lineStarts = sf.getLineStarts();
  return { skeleton: skel.join(" "), fns, parses: sf.parseDiagnostics.length === 0, lineStarts };
}

/** Offset of a 1-based line and 0-based column, clamped. */
const offset = (ls, line, col) => (ls[Math.min(Math.max(line - 1, 0), ls.length - 1)] ?? 0) + col;

/**
 * For each function of the old structure, whether the record shows it
 * entered: `true`, `false`, or `null` (no record entry maps to it).
 * A record entry [sl, sc, el, ec, hit] maps to a function when it starts
 * on the function's first line, at or before its body's first token, and
 * ends within one line of the body's end (source maps put an arrow's start
 * on the token before it, `xs.map(` for `xs.map((x) => ...)`). When several
 * entries map, any hit counts as entered: a class's field initializer and
 * its arrow field share one span. Any covered line strictly inside the body
 * also counts as entered.
 */
export function entered(old, recordSource) {
  const entries = recordSource.functions.map(([sl, sc, el, ec, hit]) => ({
    s: offset(old.lineStarts, sl, sc), e: offset(old.lineStarts, el, ec), sl, el, hit,
  }));
  const covered = bitset(recordSource.covered);
  const lineOf = (off) => { let lo = 0, hi = old.lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (old.lineStarts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
  return old.fns.map((f) => {
    const bodyEndLine = lineOf(f.bodyEnd);
    const startLine = lineOf(f.start);
    const own = entries.filter((x) => x.sl === startLine && x.s <= f.bodyStart && x.el >= bodyEndLine - 1 && x.el <= bodyEndLine + 1);
    const bl = lineOf(f.bodyStart), el = lineOf(f.bodyEnd);
    let inner = false;
    for (let l = bl + 1; l < el; l++) if (covered.has(l)) { inner = true; break; }
    if (own.some((x) => x.hit)) return true;
    if (own.length) return inner ? true : false;
    return inner ? true : null;
  });
}

export function bitset(b64) {
  const bytes = Buffer.from(b64, "base64");
  const out = new Set();
  for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) if (bytes[i] & (1 << b)) out.add(i * 8 + b + 1);
  return out;
}

/**
 * Rule A on one changed file. Returns `{ verdict, changed }`:
 * verdict "skip" (conditions 2 to 4 hold for this file), "entered" (a
 * changed function body ran), "unmapped" (a changed body has no record
 * entry and no unentered ancestor), "skeleton" (module skeleton differs),
 * "parse" (the new text does not parse). `changed` lists changed functions
 * (own tokens differ, or gone) with their entered state, for rule B.
 */
export function judge(path, oldText, newText, recordSource, cache = new Map()) {
  const get = (t) => { if (!cache.has(t)) cache.set(t, structure(path, t)); return cache.get(t); };
  const a = get(oldText), b = get(newText);
  const hit = entered(a, recordSource);
  const newByName = new Map(b.fns.map((f) => [f.name, f]));
  const changed = [];
  a.fns.forEach((f, i) => {
    const g = newByName.get(f.name);
    if (g && g.own === f.own) return;
    // entered state with ancestors: an unentered mapped ancestor means never entered
    let state = hit[i];
    for (let p = f.parent; state === null && p >= 0; p = a.fns[p].parent) if (hit[p] === false) state = false;
    changed.push({ name: f.name, line: f.line, gone: !g, entered: state });
  });
  const verdicts = [];
  if (changed.some((c) => c.entered === true)) verdicts.push("entered");
  if (changed.some((c) => c.entered === null)) verdicts.push("unmapped");
  if (a.skeleton !== b.skeleton) verdicts.push("skeleton");
  if (!b.parses) verdicts.push("parse");
  return { verdicts, changed, unmappedShare: hit.filter((h) => h === null).length / Math.max(hit.length, 1) };
}
