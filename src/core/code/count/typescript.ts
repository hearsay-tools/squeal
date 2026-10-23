import type { Node } from "web-tree-sitter";
import type { DecisionKind } from "../../types/code.js";
import type { CountRules } from "./walk.js";

/*
 * Spec 015 D3 for TS and JS, over the tree-sitter-tsx grammar: ESLint's
 * classic `complexity` rule (10.13.0, `lib/rules/complexity.js`). Each
 * function starts at 1. A class field initializer and a static block are
 * code paths of their own in ESLint, and no function here: their decision
 * points are dropped, and a function inside them is counted on its own.
 */

const FUNCTIONS = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_expression",
  "generator_function",
  "arrow_function",
  "method_definition",
]);

const CLASSES = new Set(["class_declaration", "abstract_class_declaration", "class"]);

const NAMED_DECISIONS: Readonly<Record<string, DecisionKind>> = {
  if_statement: "if",
  for_statement: "loop",
  // `for…in` and `for…of`.
  for_in_statement: "loop",
  while_statement: "loop",
  do_statement: "loop",
  // A `case` with a test; `default` is `switch_default`.
  switch_case: "case",
  catch_clause: "catch",
  ternary_expression: "ternary",
  // `?.` of a member and a subscript.
  optional_chain: "optional-chain",
  // `[a = 1]`, `{ a: b = 1 }` and `{ a = 1 }`.
  assignment_pattern: "default",
  object_assignment_pattern: "default",
};

const TOKEN_DECISIONS: Readonly<Record<string, DecisionKind>> = {
  "&&": "logical",
  "||": "logical",
  "??": "logical",
  "&&=": "logical-assignment",
  "||=": "logical-assignment",
  "??=": "logical-assignment",
};

/** Expressions that only wrap the function: `(f)`, `f as T`, `f satisfies T`, `f!`. */
const WRAPPERS = new Set([
  "parenthesized_expression",
  "as_expression",
  "satisfies_expression",
  "non_null_expression",
]);

export const TYPESCRIPT_RULES: CountRules = {
  functions: FUNCTIONS,
  classes: CLASSES,
  nameOf(node) {
    const own = node.childForFieldName("name");
    return own === null ? anonymousName(node) : keyText(own);
  },
  hashFrom(node) {
    return node.childForFieldName("parameters") ?? node.childForFieldName("parameter") ?? node;
  },
  ownPath(at) {
    return (
      at.type === "class_static_block" ||
      (at.field === "value" && at.parentType === "public_field_definition")
    );
  },
  decision(at) {
    if (at.named) return NAMED_DECISIONS[at.type] ?? null;
    // A default parameter, `a = 1`, on its `=`, so that a default `b ? 1 : 2` adds its own 1 too.
    if (at.type === "=") return isParameter(at.parentType) ? "default" : null;
    // tree-sitter-tsx 0.23.2 leaves the `?.` of a call a bare token; a member's is inside `optional_chain`.
    if (at.type === "?.") return at.parentType === "optional_chain" ? null : "optional-chain";
    return TOKEN_DECISIONS[at.type] ?? null;
  },
  descend() {
    return true;
  },
};

function isParameter(type: string | null): boolean {
  return type === "required_parameter" || type === "optional_parameter";
}

/**
 * D2: an anonymous function or class is named by the call it is passed to,
 * `<transaction>` (`<new Promise>` for a constructor), else by the variable,
 * property, field, assignment or parameter that receives it, else
 * `<anonymous>`.
 */
function anonymousName(node: Node): string {
  let parent = node.parent;
  while (parent !== null && WRAPPERS.has(parent.type)) parent = parent.parent;
  switch (parent?.type) {
    case "arguments":
      return callSite(parent.parent);
    case "variable_declarator":
    case "public_field_definition":
      return receiver(parent.childForFieldName("name"));
    case "pair":
      return receiver(parent.childForFieldName("key"));
    case "assignment_expression":
    // A default: `{ cb = () => {} }`, `[cb = () => {}]`.
    case "assignment_pattern":
    case "object_assignment_pattern":
      return receiver(parent.childForFieldName("left"));
    // A default parameter: `cb = () => {}`.
    case "required_parameter":
    case "optional_parameter":
      return receiver(parent.childForFieldName("pattern"));
    default:
      return "<anonymous>";
  }
}

function callSite(call: Node | null): string {
  if (call?.type === "call_expression") {
    const callee = calleeName(call.childForFieldName("function"));
    return callee === null ? "<anonymous>" : `<${callee}>`;
  }
  if (call?.type === "new_expression") {
    const callee = calleeName(call.childForFieldName("constructor"));
    return callee === null ? "<anonymous>" : `<new ${callee}>`;
  }
  return "<anonymous>";
}

/** `f` of `f(…)`, `map` of `xs.map(…)`; `null` for any other callee. */
function calleeName(callee: Node | null): string | null {
  if (callee?.type === "identifier") return callee.text;
  if (callee?.type === "member_expression")
    return callee.childForFieldName("property")?.text ?? null;
  return null;
}

/** Receivers that name nothing: `const { a } = …`, `[a] = …`, `a[k] = …`. */
const NAMELESS = new Set(["object_pattern", "array_pattern", "subscript_expression"]);

/** The receiving name: an identifier or a key, a member's property. */
function receiver(target: Node | null): string {
  if (target === null || NAMELESS.has(target.type)) return "<anonymous>";
  if (target.type === "member_expression") {
    return target.childForFieldName("property")?.text ?? "<anonymous>";
  }
  return keyText(target);
}

/** A key's text, a string key without its quotes. */
function keyText(key: Node): string {
  return key.type === "string" ? key.text.slice(1, -1) : key.text;
}
