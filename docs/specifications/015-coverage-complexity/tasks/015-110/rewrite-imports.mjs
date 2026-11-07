#!/usr/bin/env node
// Row 015-110: point every import of a barrel at the module that defines the name.
//
// A barrel is a module under src/ or test/ (not test/fixtures) whose statements are only
// import and export declarations, with at least one export. Never one: src/cli/index.ts (the
// `squeal` bin entry) and test/keys/validity/entries/*.ts (the key alarm's entry lists, which
// test/keys/validity/driver.ts re-exports as namespaces so its bundle keeps them whole).
//
// It rewrites, in src/** and test/** (not test/fixtures):
//   - `import { a, type B } from "<module>"`, split per defining module;
//   - `export { a } from "<module>"`, split the same way;
//   - `import("<barrel>")` and `typeof import("<barrel>")` when the names used resolve to one module
//     (`const { a } = await import(...)`, `import(...).then(({ a }) => ...)`, `typeof import(...).A`).
// A name a module re-exports without defining it moves too, from any module, not only a barrel.
// It reports, without rewriting: namespace and default imports of a barrel, `export *` from a
// barrel, side-effect imports, `vi.mock`/`vi.importActual`/`vi.doMock` paths and other import()
// forms that name a barrel, and barrel imports outside src/ and test/: those are hand fixes.
// It also lists mocks and dynamic imports of a module that defines code and re-exports, to check.
// It keeps the key alarm's barrel imports in test/keys/validity/ (`KEEP_IMPORT`, below).
//
// Usage, from the repository root:
//   node docs/specifications/015-coverage-complexity/tasks/015-110/rewrite-imports.mjs [--write] [--delete] [--skip <path>]...
// Without --write it prints the report only. --delete removes barrels that nothing names any more.
// --skip leaves a file another row owns as it is; the barrels it names stay.
// Run `pnpm exec biome check --write` over the changed files after it: Biome merges and sorts.
// TypeScript 6 comes from the lint fixture workspace: the repository's TypeScript 7 has no
// stable JS API.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const ts = createRequire(join(root, "test/fixtures/lint/toolchain/package.json"))("typescript");
const argv = process.argv.slice(2);
const args = new Set(argv);
const write = args.has("--write");
const del = args.has("--delete");
// --skip <path>: a file another row owns; it keeps its imports, and the barrels it names stay
const skip = new Set(argv.flatMap((a, i) => (argv[i - 1] === "--skip" ? [a] : [])));

const rel = (abs) => relative(root, abs).split("\\").join("/");
const CODE = /\.(ts|tsx|mts|cts|mjs|cjs|js)$/;
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((f) => CODE.test(f) && !f.endsWith(".d.ts") && !f.startsWith("docs/"));
const inScope = (f) => /^(src|test)\//.test(f) && !f.startsWith("test/fixtures/");
const KEEP = (f) => f === "src/cli/index.ts" || f.startsWith("test/keys/validity/entries/");
// Imports kept as they are (the coordinator, 2026-11-07). The key alarm's entries re-export the
// keys and recorder barrels as namespaces: their emitted code is what the alarm compares with the
// last release. Its harness is bundled against older releases too (test/keys/validity/notes.md,
// `bundle.ts`): through the keys barrel harness.ts finds `environmentHash`, whose module
// (keys/environment-hash.ts, v0.1.388) is newer than the oldest release it compares
// (squeal--v0.1.232), and assemble.ts reads the barrel as a namespace, `observedStartupMetaKey?.`.
const KEEP_IMPORT = (from, target) =>
  from.startsWith("test/keys/validity/entries/") ||
  (target === "src/core/keys/index.ts" &&
    ["test/keys/validity/harness.ts", "test/keys/validity/harness/assemble.ts"].includes(from));

const config = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => {
    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  },
});
const options = { ...config.options, allowJs: true, noEmit: true };
const program = ts.createProgram({
  rootNames: tracked.filter(inScope).map((f) => join(root, f)),
  options,
});
const checker = program.getTypeChecker();

const sources = new Map();
function sourceOf(abs) {
  let sf = sources.get(abs) ?? program.getSourceFile(abs);
  if (!sf) {
    const text = readFileSync(abs, "utf8");
    sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
  }
  sources.set(abs, sf);
  return sf;
}
function resolveSpec(spec, fromAbs) {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const r = ts.resolveModuleName(spec, fromAbs, options, ts.sys).resolvedModule;
  if (r?.resolvedFileName && !r.resolvedFileName.includes("/node_modules/")) return r.resolvedFileName;
  return null;
}

// ---- barrels and their export maps
const barrelCache = new Map();
function isBarrel(abs) {
  if (barrelCache.has(abs)) return barrelCache.get(abs);
  const f = rel(abs);
  let result = false;
  if (inScope(f) && !KEEP(f)) {
    const sf = sourceOf(abs);
    const stmts = sf.statements;
    result =
      stmts.length > 0 &&
      stmts.every((s) => ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
      stmts.some((s) => ts.isExportDeclaration(s));
  }
  barrelCache.set(abs, result);
  return result;
}

/** Names a module exports, from the checker. */
function exportNames(abs) {
  const sf = sourceOf(abs);
  const sym = program.getSourceFile(abs) ? checker.getSymbolAtLocation(sf) : undefined;
  if (sym) return checker.getExportsOfModule(sym).map((s) => s.escapedName.toString());
  throw new Error(`export * from ${rel(abs)}: not in the program`);
}

/** Names a module declares and exports itself. */
function declaredExports(sf) {
  const names = new Set();
  const exported = (s) => ts.getCombinedModifierFlags(s) & ts.ModifierFlags.Export;
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s) && exported(s)) {
      const bind = (n) => {
        if (ts.isIdentifier(n)) names.add(n.text);
        else for (const el of n.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
      };
      for (const d of s.declarationList.declarations) bind(d.name);
    } else if (s.name && ts.isIdentifier(s.name) && exported(s)) names.add(s.name.text);
  }
  return names;
}

const mapCache = new Map();
/**
 * name -> { module, name, typeOnly } for each name a module re-exports and does not define,
 * one hop: `export ... from`, `export *` and an imported name exported again.
 */
function exportMap(abs) {
  if (mapCache.has(abs)) return mapCache.get(abs);
  const map = new Map();
  mapCache.set(abs, map);
  if (!inScope(rel(abs)) || KEEP(rel(abs))) return map;
  const sf = sourceOf(abs);
  const own = declaredExports(sf);
  const imported = new Map();
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !s.importClause?.namedBindings) continue;
    const target = resolveSpec(s.moduleSpecifier.text, abs);
    if (!target || !ts.isNamedImports(s.importClause.namedBindings)) continue;
    for (const el of s.importClause.namedBindings.elements)
      imported.set(el.name.text, {
        module: target,
        name: (el.propertyName ?? el.name).text,
        typeOnly: s.importClause.isTypeOnly || el.isTypeOnly,
      });
  }
  for (const s of sf.statements) {
    if (!ts.isExportDeclaration(s)) continue;
    const target = s.moduleSpecifier ? resolveSpec(s.moduleSpecifier.text, abs) : null;
    if (s.moduleSpecifier && !target) throw new Error(`${rel(abs)}: cannot resolve ${s.moduleSpecifier.text}`);
    if (!s.exportClause) {
      for (const n of exportNames(target))
        if (n !== "default" && !own.has(n) && !map.has(n))
          map.set(n, { module: target, name: n, typeOnly: s.isTypeOnly });
      continue;
    }
    if (ts.isNamespaceExport(s.exportClause)) {
      map.set(s.exportClause.name.text, { module: target, name: "*", typeOnly: s.isTypeOnly });
      continue;
    }
    for (const el of s.exportClause.elements) {
      const from = (el.propertyName ?? el.name).text;
      const typeOnly = s.isTypeOnly || el.isTypeOnly;
      if (target) map.set(el.name.text, { module: target, name: from, typeOnly });
      else {
        const i = imported.get(from);
        if (i) map.set(el.name.text, { ...i, typeOnly: i.typeOnly || typeOnly });
      }
    }
  }
  return map;
}

/** Follows a name through re-exports to the module that defines it; null when a barrel lacks it. */
function defining(moduleAbs, name) {
  let at = { module: moduleAbs, name, typeOnly: false };
  const seen = new Set();
  for (;;) {
    const key = `${at.module}#${at.name}`;
    if (seen.has(key)) throw new Error(`re-export cycle at ${rel(at.module)} ${at.name}`);
    seen.add(key);
    const next = at.name === "*" ? undefined : exportMap(at.module).get(at.name);
    if (!next) return isBarrel(at.module) && at.name !== "*" ? null : at;
    at = { module: next.module, name: next.name, typeOnly: at.typeOnly || next.typeOnly };
  }
}
/** Whether an import of `names` from `abs` should name other modules. */
const reexports = (abs, names) => isBarrel(abs) || names.some((n) => exportMap(abs).has(n));

function specifierFor(fromAbs, targetAbs, original) {
  let p = relative(dirname(fromAbs), targetAbs).split("\\").join("/");
  if (!p.startsWith(".")) p = `./${p}`;
  if (/\.ts$/.test(original)) return p;
  return p.replace(/\.tsx?$/, ".js").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs");
}
const quoteOf = (lit, sf) => lit.getText(sf)[0];

// ---- the walk
const report = { handFix: [], outside: [], mixed: [] };
const changed = new Map(); // abs -> edits
const named = new Map(); // barrel abs -> set of files that still name it
let current = null; // the file the walk is in
const note = (barrel) => named.set(barrel, (named.get(barrel) ?? new Set()).add(current));
const where = (sf, node) => `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

function edit(sf, start, end, text) {
  const list = changed.get(sf.fileName) ?? [];
  list.push({ start, end, text });
  changed.set(sf.fileName, list);
}

/** Groups { name, local, typeOnly } elements per defining module; null when one cannot resolve. */
function groupElements(sf, barrel, elements) {
  const groups = new Map();
  for (const el of elements) {
    const d = defining(barrel, el.name);
    if (!d || d.name === "*") return null;
    const g = groups.get(d.module) ?? [];
    g.push({ name: d.name, local: el.local, typeOnly: el.typeOnly || d.typeOnly });
    groups.set(d.module, g);
  }
  return groups;
}

function declText(kind, typeKw, specs, path, q) {
  return `${kind} ${typeKw}{ ${specs.join(", ")} } from ${q}${path}${q};`;
}

/** Rewrites one import or export declaration: "moved", "kept" (nothing to move) or "hand". */
function rewriteDeclaration(sf, s, target) {
  const isImport = ts.isImportDeclaration(s);
  const barrel = isBarrel(target);
  const original = s.moduleSpecifier.text;
  const q = quoteOf(s.moduleSpecifier, sf);
  let declTypeOnly;
  let list;
  if (isImport) {
    const clause = s.importClause;
    if (!clause) return barrel ? "hand" : "kept"; // a side-effect import
    if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
      return barrel ? "hand" : "kept"; // a default or namespace import
    declTypeOnly = clause.isTypeOnly;
    list = clause.namedBindings.elements;
  } else {
    if (!s.exportClause || !ts.isNamedExports(s.exportClause)) return barrel ? "hand" : "kept";
    declTypeOnly = s.isTypeOnly;
    list = s.exportClause.elements;
  }
  const elements = list.map((el) => ({
    name: (el.propertyName ?? el.name).text,
    local: el.name.text,
    typeOnly: el.isTypeOnly,
  }));
  if (!reexports(target, elements.map((e) => e.name))) return "kept";
  const groups = groupElements(sf, target, elements);
  if (!groups) return "hand";
  if (groups.size === 1 && groups.has(target)) return "kept";
  const kind = isImport ? "import" : "export";
  const out = [];
  for (const [module, els] of groups) {
    const allTypes = declTypeOnly || els.every((e) => e.typeOnly);
    const specs = els.map((e) => {
      const head = !allTypes && e.typeOnly ? "type " : "";
      return e.name === e.local ? `${head}${e.local}` : `${head}${e.name} as ${e.local}`;
    });
    const path = module === target ? original : specifierFor(sf.fileName, module, original);
    out.push(declText(kind, allTypes ? "type " : "", specs, path, q));
  }
  edit(sf, s.getStart(sf), s.end, out.join("\n"));
  return "moved";
}

/** Names taken from a dynamic import(), when the code shows them; null otherwise. */
function namesFromDynamic(call) {
  let node = call.parent;
  if (ts.isAwaitExpression(node)) {
    const decl = node.parent;
    if (ts.isVariableDeclaration(decl) && ts.isObjectBindingPattern(decl.name)) {
      const names = [];
      for (const el of decl.name.elements) {
        if (el.dotDotDotToken) return null;
        const key = el.propertyName ?? el.name;
        if (!ts.isIdentifier(key)) return null;
        names.push(key.text);
      }
      return names;
    }
    if (ts.isPropertyAccessExpression(decl) && decl.expression === node) return [decl.name.text];
    if (ts.isParenthesizedExpression(decl) && ts.isPropertyAccessExpression(decl.parent))
      return [decl.parent.name.text];
    return null;
  }
  if (ts.isPropertyAccessExpression(node) && node.name.text === "then") {
    const thenCall = node.parent;
    const fn = ts.isCallExpression(thenCall) ? thenCall.arguments[0] : undefined;
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return null;
    const p = fn.parameters[0]?.name;
    if (p && ts.isObjectBindingPattern(p)) {
      const names = [];
      for (const el of p.elements) {
        const key = el.propertyName ?? el.name;
        if (el.dotDotDotToken || !ts.isIdentifier(key)) return null;
        names.push(key.text);
      }
      return names;
    }
    if (p && ts.isIdentifier(p)) {
      const names = new Set();
      let other = false;
      const visit = (n) => {
        if (ts.isIdentifier(n) && n.text === p.text && n !== p) {
          if (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) names.add(n.parent.name.text);
          else other = true;
        }
        ts.forEachChild(n, visit);
      };
      visit(fn.body);
      return other || names.size === 0 ? null : [...names];
    }
  }
  return null;
}

function oneModule(barrel, names) {
  let target = null;
  for (const n of names) {
    const d = defining(barrel, n);
    if (!d || d.name !== n) return null;
    if (target && target !== d.module) return null;
    target = d.module;
  }
  return target;
}

const MOCK = /^(mock|doMock|unmock|doUnmock|importActual|importMock)$/;

function walk(sf) {
  current = sf.fileName;
  const f = rel(sf.fileName);
  const scoped = inScope(f) && !skip.has(f);
  const at = (node) => where(sf, node);
  const visit = (node) => {
    // static import / export ... from
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const target = resolveSpec(node.moduleSpecifier.text, sf.fileName);
      if (target && inScope(rel(target))) {
        if (KEEP_IMPORT(f, rel(target))) note(target);
        else if (!scoped) {
          if (isBarrel(target)) {
            report.outside.push(`${at(node)} ${node.moduleSpecifier.text}`);
            note(target);
          }
        } else if (rewriteDeclaration(sf, node, target) === "hand") {
          report.handFix.push(`${at(node)} ${node.getText(sf).split("\n")[0]}`);
          note(target);
        }
      }
      return;
    }
    // import("x")
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      const target = arg && ts.isStringLiteralLike(arg) ? resolveSpec(arg.text, sf.fileName) : null;
      if (target && inScope(rel(target)) && (isBarrel(target) || exportMap(target).size > 0)) {
        const names = scoped ? namesFromDynamic(node) : null;
        const to = names && oneModule(target, names);
        if (to && to !== target)
          edit(sf, arg.getStart(sf) + 1, arg.end - 1, specifierFor(sf.fileName, to, arg.text));
        else if (isBarrel(target)) {
          (scoped ? report.handFix : report.outside).push(`${at(node)} import(${arg.text})`);
          note(target);
        } else if (!to && (!names || reexports(target, names)))
          report.mixed.push(`${at(node)} import(${arg.text})`);
      }
    }
    // typeof import("x").Name
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const lit = node.argument.literal;
      const target = resolveSpec(lit.text, sf.fileName);
      if (target && inScope(rel(target))) {
        const q = node.qualifier;
        const first = q && (ts.isIdentifier(q) ? q.text : leftmost(q));
        const d = first && defining(target, first);
        if (scoped && d && d.name === first && d.module !== target)
          edit(sf, lit.getStart(sf) + 1, lit.end - 1, specifierFor(sf.fileName, d.module, lit.text));
        else if (isBarrel(target)) {
          (scoped ? report.handFix : report.outside).push(
            `${at(node)} typeof import(${lit.text})${first ? `.${first}` : ""}`,
          );
          note(target);
        }
      }
    }
    // vi.mock("x") and friends: a mock follows the module that defines what it replaces
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "vi" &&
      MOCK.test(node.expression.name.text)
    ) {
      const arg = node.arguments[0];
      const target = arg && ts.isStringLiteralLike(arg) ? resolveSpec(arg.text, sf.fileName) : null;
      if (target && isBarrel(target)) {
        report.handFix.push(`${at(node)} vi.${node.expression.name.text}(${arg.text})`);
        note(target);
      } else if (target && exportMap(target).size > 0)
        report.mixed.push(`${at(node)} vi.${node.expression.name.text}(${arg.text}) re-exports`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
function leftmost(q) {
  while (ts.isQualifiedName(q)) q = q.left;
  return q.text;
}

const barrels = tracked.filter(inScope).map((f) => join(root, f)).filter(isBarrel);
for (const f of tracked) walk(sourceOf(join(root, f)));

// A barrel goes when only barrels that also go still name it.
const removable = new Set(barrels);
for (let again = true; again; ) {
  again = false;
  for (const b of removable)
    if ([...(named.get(b) ?? [])].some((r) => !removable.has(r))) {
      removable.delete(b);
      again = true;
    }
}
const left = barrels.filter((b) => !removable.has(b));

let files = 0;
for (const [abs, edits] of changed) {
  if (del && removable.has(abs)) continue;
  files++;
  if (!write) continue;
  let text = readFileSync(abs, "utf8");
  for (const e of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  writeFileSync(abs, text);
}

if (del && write) for (const b of removable) rmSync(b);

console.log(`barrels: ${barrels.length}`);
for (const b of barrels) {
  const by = [...(named.get(b) ?? [])].map(rel);
  console.log(`  ${rel(b)}${removable.has(b) ? "" : `  (stays: named by ${by.join(", ")})`}`);
}
console.log(`files ${write ? "rewritten" : "to rewrite"}: ${files}`);
console.log(`hand fixes (${report.handFix.length}):`);
for (const l of report.handFix) console.log(`  ${l}`);
console.log(`to check, a module that defines code and re-exports (${report.mixed.length}):`);
for (const l of report.mixed) console.log(`  ${l}`);
console.log(`outside src/ and test/, or skipped (${report.outside.length}):`);
for (const l of report.outside) console.log(`  ${l}`);
console.log(`barrels that stay: ${left.length}; ${del && write ? "deleted" : "removable"}: ${removable.size}`);
