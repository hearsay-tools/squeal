// Throwaway probe (015-02). Per-function cyclomatic complexity over a tree-sitter tree.
// TS/JS rules copy ESLint 10.13.0 `complexity` (classic); Python rules copy radon 6.0.1 ComplexityVisitor.
const TS_FUNCTIONS = new Set([
  "function_declaration", "generator_function_declaration", "function_expression", "function",
  "generator_function", "arrow_function", "method_definition",
]);
const TS_DECISIONS = new Set([
  "if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement",
  "catch_clause", "ternary_expression", "switch_case", "optional_chain", "assignment_pattern",
  "object_assignment_pattern",
]);
const LOGICAL = new Set(["&&", "||", "??"]);
const LOGICAL_ASSIGN = new Set(["&&=", "||=", "??="]);

/** Which ESLint increment `n` is, for the breakdown: null when none. */
export function tsCategory(n) {
  if (!n.isNamed) return n.type === "?." && n.parent?.type !== "optional_chain" ? "optional" : null;
  if (n.type === "optional_chain") return "optional";
  if (n.type === "binary_expression") { const op = n.childForFieldName("operator")?.type; return op === "??" ? "nullish" : LOGICAL.has(op) ? "andOr" : null; }
  if (n.type === "augmented_assignment_expression") return LOGICAL_ASSIGN.has(n.childForFieldName("operator")?.type) ? "logicalAssign" : null;
  if (n.type === "assignment_pattern" || n.type === "object_assignment_pattern" || ((n.type === "required_parameter" || n.type === "optional_parameter") && n.childForFieldName("value"))) return "default";
  return TS_DECISIONS.has(n.type) ? "control" : null;
}

function tsIncrement(n) {
  if (!n.isNamed) {
    // tree-sitter-typescript 0.23.2 leaves `?.` of a call as a bare token; javascript 0.25.0 wraps it.
    return n.type === "?." && n.parent?.type !== "optional_chain" ? 1 : 0;
  }
  if (TS_DECISIONS.has(n.type)) return 1;
  if (n.type === "binary_expression") return LOGICAL.has(n.childForFieldName("operator")?.type) ? 1 : 0;
  if (n.type === "augmented_assignment_expression")
    return LOGICAL_ASSIGN.has(n.childForFieldName("operator")?.type) ? 1 : 0;
  // TS default parameter: `a = 1` is required_parameter/optional_parameter with a `value` field.
  if ((n.type === "required_parameter" || n.type === "optional_parameter") && n.childForFieldName("value")) return 1;
  return 0;
}

function pyIncrement(n) {
  switch (n.type) {
    case "if_statement": case "elif_clause": case "conditional_expression": case "boolean_operator":
    case "except_clause": case "except_group_clause": case "assert_statement":
    case "for_in_clause":
      return 1;
    case "for_statement": case "while_statement":
      return 1 + (n.childForFieldName("alternative") ? 1 : 0);
    case "if_clause": // a comprehension's `if`; radon does not count a `case ... if` guard
      return n.parent?.type === "case_clause" ? 0 : 1;
    case "try_statement":
      return n.namedChildren.some((c) => c.type === "else_clause") ? 1 : 0;
    case "case_clause": {
      // radon: `case _:` (a bare wildcard) is the else and does not count.
      const pat = n.namedChildren.find((c) => c.type === "case_pattern");
      return pat && pat.text.trim() === "_" ? 0 : 1;
    }
    default:
      return 0;
  }
}

function tsName(n) {
  const own = n.childForFieldName("name");
  if (own) return own.text;
  const p = n.parent;
  if (!p) return null;
  if (p.type === "variable_declarator") return p.childForFieldName("name")?.text ?? null;
  if (p.type === "pair") return p.childForFieldName("key")?.text ?? null;
  if (p.type === "public_field_definition") return p.childForFieldName("name")?.text ?? null;
  if (p.type === "assignment_expression") return p.childForFieldName("left")?.text ?? null;
  return null;
}

function callSite(n) {
  const args = n.parent?.type === "arguments" ? n.parent : null;
  const call = args?.parent;
  if (!call || (call.type !== "call_expression" && call.type !== "new_expression")) return "anonymous";
  const callee = call.childForFieldName("function") ?? call.childForFieldName("constructor");
  const text = callee?.type === "member_expression" ? callee.childForFieldName("property")?.text : callee?.text;
  return text && text.length <= 40 ? `${call.type === "new_expression" ? "new " : ""}${text}` : "anonymous";
}

/** Returns [{ name, line, col, endLine, cc }] for every function, line 1-based, col 0-based. */
export function countFunctions(tree, language) {
  const python = language === "python";
  const out = [];
  const stack = []; // { rec, anon }
  const scopes = []; // names of enclosing classes and functions
  function visit(n) {
    const isFn = n.isNamed && (python ? n.type === "function_definition" : TS_FUNCTIONS.has(n.type));
    const isClass = n.isNamed && (python ? n.type === "class_definition" : n.type === "class_declaration" || n.type === "class");
    let pushedScope = false;
    if (isFn) {
      const parent = stack.at(-1);
      let name = python ? n.childForFieldName("name")?.text : tsName(n);
      if (!name) {
        // CC_NAMING=callsite names a callback by the call it is passed to (`<entries.map>`), numbered only
        // among siblings with the same base; the default numbers every anonymous function in its parent.
        const base = process.env.CC_NAMING === "callsite" ? callSite(n) : "anonymous";
        const counts = parent ? (parent.anonBy ??= new Map()) : (visit.topAnonBy ??= new Map());
        const k = counts.get(base) ?? 0; counts.set(base, k + 1);
        if (parent) parent.anon++;
        name = `<${base}#${k}>`;
      }
      const rec = {
        name: [...scopes, name].join("."),
        line: n.startPosition.row + 1, col: n.startPosition.column, endLine: n.endPosition.row + 1, cc: 1,
        endCol: n.endPosition.column,
        // Start of the body; for `=> (expr)` also of `expr`, where coverage-v8 starts the function.
        bodies: (() => {
          const b = n.childForFieldName("body");
          if (!b) return [];
          const at = (x) => ({ line: x.startPosition.row + 1, col: x.startPosition.column });
          return b.type === "parenthesized_expression" && b.namedChild(0) ? [at(b), at(b.namedChild(0))] : [at(b)];
        })(),
      };
      out.push(rec);
      stack.push({ rec, anon: 0 });
      scopes.push(name);
      pushedScope = true;
    } else if (isClass) {
      scopes.push(n.childForFieldName("name")?.text ?? "<class>");
      pushedScope = true;
    } else if (stack.length) {
      const inc = python ? pyIncrement(n) : tsIncrement(n);
      stack.at(-1).rec.cc += inc;
      if (!python && inc) { const c = tsCategory(n); const parts = (stack.at(-1).rec.parts ??= {}); parts[c] = (parts[c] ?? 0) + inc; }
    }
    // radon's visit_Assert adds 1 and does not descend: `and`/`or` inside an assert do not count.
    if (!(python && n.type === "assert_statement")) for (let i = 0; i < n.childCount; i++) visit(n.child(i));
    if (pushedScope) scopes.pop();
    if (isFn) stack.pop();
  }
  visit.topAnon = 0;
  visit(tree.rootNode);
  return out;
}
