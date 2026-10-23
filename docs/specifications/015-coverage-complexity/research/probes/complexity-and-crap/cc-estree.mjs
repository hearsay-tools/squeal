// Throwaway probe (015-02). Per-function cyclomatic complexity over an ESTree (acorn or oxc-parser),
// with the increments of ESLint 10.13.0 `complexity`, variant classic.
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const PLUS_ONE = new Set([
  "CatchClause", "ConditionalExpression", "LogicalExpression", "ForStatement", "ForInStatement",
  "ForOfStatement", "IfStatement", "WhileStatement", "DoWhileStatement", "AssignmentPattern",
]);
const SKIP = new Set(["parent", "loc", "range", "start", "end", "typeAnnotation", "returnType", "typeParameters", "typeArguments", "decorators"]);

function increment(n) {
  if (PLUS_ONE.has(n.type)) return 1;
  if (n.type === "SwitchCase") return n.test ? 1 : 0;
  if (n.type === "AssignmentExpression") return ["&&=", "||=", "??="].includes(n.operator) ? 1 : 0;
  if ((n.type === "MemberExpression" || n.type === "CallExpression") && n.optional === true) return 1;
  return 0;
}

function nameOf(n, parent) {
  if (n.id?.name) return n.id.name;
  if (!parent) return null;
  if (parent.type === "VariableDeclarator") return parent.id?.name ?? null;
  if (parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition")
    return parent.key?.name ?? parent.key?.value ?? null;
  return null;
}

/** `lineOf(offset)` maps a node's start offset to [line 1-based, col 0-based]. */
export function countFunctions(program, lineOf) {
  const out = [];
  const stack = [];
  const scopes = [];
  function visit(n, parent) {
    if (!n || typeof n.type !== "string") return;
    const isFn = FUNCTIONS.has(n.type);
    const isClass = n.type === "ClassDeclaration" || n.type === "ClassExpression";
    if (isFn) {
      const top = stack.at(-1);
      // A method's FunctionExpression starts at `(`; report the method key's start, as tree-sitter does.
      const anchor = parent && (parent.type === "MethodDefinition" || parent.type === "Property" && parent.method) ? parent : n;
      let name = nameOf(n, parent);
      if (!name) name = `<anonymous#${top ? top.anon++ : 0}>`;
      const [line, col] = lineOf(anchor.start);
      const rec = { name: [...scopes, name].join("."), line, col, endLine: lineOf(n.end)[0], cc: 1 };
      out.push(rec);
      stack.push({ rec, anon: 0 });
      scopes.push(name);
    } else if (isClass) {
      scopes.push(n.id?.name ?? "<class>");
    } else if (stack.length) {
      stack.at(-1).rec.cc += increment(n);
    }
    for (const key of Object.keys(n)) {
      if (SKIP.has(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) for (const c of v) visit(c, n);
      else if (v && typeof v === "object") visit(v, n);
    }
    if (isFn || isClass) scopes.pop();
    if (isFn) stack.pop();
  }
  visit(program, null);
  return out;
}

export function lineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return [lo + 1, off - starts[lo]];
  };
}
