import type { Node } from "web-tree-sitter";
import type { DecisionKind } from "../../types/code.js";
import type { CountRules } from "./walk.js";

/*
 * Spec 015 D3 for Python: radon 6.0.1's `ComplexityVisitor`
 * (`radon/visitors.py`). A function counts only its body: radon never
 * visits its decorators, defaults or annotations, nor a class body outside
 * its methods, so their decision points are dropped. A lambda is no
 * function: its decision points are its parent's. Radon's own gaps are kept,
 * so its number and Squeal's agree: `except*` (a `TryStar`) adds nothing,
 * not even its `else`, and an `assert` adds 1 without its operands.
 */

const NAMED_DECISIONS: Readonly<Record<string, DecisionKind>> = {
  if_statement: "if",
  elif_clause: "if",
  conditional_expression: "ternary",
  // `a and b and c` is two nested operators, as radon's `len(values) - 1`.
  boolean_operator: "logical",
  for_statement: "loop",
  while_statement: "loop",
  for_in_clause: "comprehension",
  assert_statement: "assert",
};

export const PYTHON_RULES: CountRules = {
  functions: new Set(["function_definition"]),
  classes: new Set(["class_definition"]),
  nameOf(node) {
    return node.childForFieldName("name")?.text ?? "<anonymous>";
  },
  hashFrom(node) {
    return node.childForFieldName("parameters") ?? node;
  },
  ownPath(at) {
    return (
      at.type === "class_definition" ||
      at.type === "decorator" ||
      (at.parentType === "function_definition" && at.field !== "body")
    );
  },
  decision(at, cursor) {
    if (!at.named) return null;
    switch (at.type) {
      case "except_clause":
        return isStarExcept(cursor.currentNode) ? null : "catch";
      case "else_clause":
        return loopOrTryElse(cursor.currentNode) ? "else" : null;
      case "if_clause":
        // A comprehension's `if`; a `case … if` guard adds nothing.
        return at.parentType === "case_clause" ? null : "comprehension";
      case "case_clause":
        return firstCapture(cursor.currentNode) ? null : "case";
      default:
        return NAMED_DECISIONS[at.type] ?? null;
    }
  },
  descend(at) {
    // radon's `visit_Assert` does not descend: an `and` inside an `assert` adds nothing.
    return at.type !== "assert_statement";
  },
};

function isStarExcept(clause: Node): boolean {
  return clause.children.some((child) => child?.type === "*");
}

/** A loop's `else` or a `try`'s, which radon counts; an `if`'s is not a decision. */
function loopOrTryElse(clause: Node): boolean {
  const parent = clause.parent;
  if (parent?.type === "for_statement" || parent?.type === "while_statement") return true;
  if (parent?.type !== "try_statement") return false;
  return !parent.namedChildren.some(
    (child) => child?.type === "except_clause" && isStarExcept(child),
  );
}

/**
 * radon counts a `match` as its cases less one when any case is a bare name,
 * `case _:` or a capture `case x:`, guarded or not: the first such case adds
 * nothing.
 */
function firstCapture(clause: Node): boolean {
  if (!isCapture(clause)) return false;
  for (
    let sibling = clause.previousNamedSibling;
    sibling !== null;
    sibling = sibling.previousNamedSibling
  ) {
    if (sibling.type === "case_clause" && isCapture(sibling)) return false;
  }
  return true;
}

function isCapture(clause: Node): boolean {
  const patterns = clause.namedChildren.filter((child) => child?.type === "case_pattern");
  if (patterns.length !== 1) return false;
  const pattern = patterns[0] as Node;
  if (pattern.text.trim() === "_") return true;
  const only = pattern.namedChildCount === 1 ? pattern.namedChild(0) : null;
  return only?.type === "dotted_name" && only.namedChildCount === 1;
}
