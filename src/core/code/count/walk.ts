import { createHash } from "node:crypto";
import type { Node, TreeCursor } from "web-tree-sitter";
import type { CodeRange, DecisionKind, FunctionCount } from "../../types/code.js";

/** Where the walk is: the node's type, its field in its parent and the parent's type. */
export interface At {
  readonly type: string;
  readonly named: boolean;
  /** Read only under a parent of `CountRules.fieldParents`; `null` elsewhere. */
  readonly field: string | null;
  readonly parentType: string | null;
}

/** One language's counting rules (spec 015 D3). */
export interface CountRules {
  /** Named node types that are functions, each counted on its own. */
  readonly functions: ReadonlySet<string>;
  /** Named node types that are classes: a scope of the qualified name, never counted. */
  readonly classes: ReadonlySet<string>;
  /** Parent types whose children's field names the rules read; the walk reads no other. */
  readonly fieldParents: ReadonlySet<string>;
  /**
   * A function's or a class's name (D2); an anonymous one's from its call site or receiver.
   * `text` is the file's own, which the parse input can differ from at the same offsets.
   */
  nameOf(node: Node, text: string): string;
  /** Where a function's hashed text starts: after its name, so a rename keeps the hash (D2). */
  hashFrom(node: Node): Node;
  /** A node whose decision points are no function's: dropped, its nested functions counted. */
  ownPath(at: At): boolean;
  /** The decision point a node is, adding 1; `cursor` stands on it. */
  decision(at: At, cursor: TreeCursor): DecisionKind | null;
  /** Whether the walk enters the node's children. */
  descend(at: At): boolean;
  /** An `ERROR` node around valid syntax the grammar lacks: no parse error. */
  grammarGap(error: Node): boolean;
}

export interface TreeCount {
  readonly functions: readonly FunctionCount[];
  readonly errors: readonly CodeRange[];
}

interface Open {
  readonly qualifiedName: string;
  readonly range: CodeRange;
  readonly bodyHash: string;
  complexity: number;
  readonly decisions: Partial<Record<DecisionKind, number>>;
}

/** What leaving an entered node undoes. */
interface Exit {
  scope: boolean;
  frame: boolean;
  error: boolean;
}

/**
 * Every function of `root` in source order, with its CC by `rules`, and the
 * ranges the parser could not read (D3). One pass with a cursor: a node is
 * made only for a function, a class and the few decisions that need one.
 */
export function countTree(root: Node, text: string, rules: CountRules): TreeCount {
  const opened: Open[] = [];
  const errors: CodeRange[] = [];
  const names: string[] = [];
  // The function each decision point belongs to; `null` drops it (`ownPath`).
  const frames: (Open | null)[] = [];
  const ancestors: string[] = [];
  const exits: Exit[] = [];
  const findErrors = root.hasError;
  let inError = 0;
  const cursor = root.walk();
  try {
    for (;;) {
      const type = cursor.nodeType;
      const named = cursor.nodeIsNamed;
      const parentType = ancestors.at(-1) ?? null;
      const field =
        parentType !== null && rules.fieldParents.has(parentType) ? cursor.currentFieldName : null;
      const at: At = { type, named, field, parentType };
      const exit: Exit = { scope: false, frame: false, error: false };
      if (findErrors && inError === 0 && isError(cursor, rules)) {
        errors.push(rangeAt(cursor));
        exit.error = type === "ERROR";
        if (exit.error) inError++;
      }
      const ownPath = rules.ownPath(at);
      // A node's own decision goes to the function around it; an `ownPath` node's is dropped.
      const frame = ownPath ? null : frames.at(-1);
      const kind = frame ? rules.decision(at, cursor) : null;
      if (frame && kind !== null) {
        frame.complexity++;
        frame.decisions[kind] = (frame.decisions[kind] ?? 0) + 1;
      }
      if (named && rules.functions.has(type)) {
        const node = cursor.currentNode;
        const name = rules.nameOf(node, text);
        const open: Open = {
          qualifiedName: [...names, name].join("."),
          range: rangeAt(cursor),
          bodyHash: bodyHash(text, rules.hashFrom(node).startIndex, node.endIndex),
          complexity: 1,
          decisions: {},
        };
        opened.push(open);
        frames.push(open);
        names.push(name);
        exit.frame = exit.scope = true;
      } else {
        if (named && rules.classes.has(type)) {
          names.push(rules.nameOf(cursor.currentNode, text));
          exit.scope = true;
        }
        if (ownPath) {
          frames.push(null);
          exit.frame = true;
        }
      }
      if (rules.descend(at) && cursor.gotoFirstChild()) {
        ancestors.push(type);
        exits.push(exit);
        continue;
      }
      leave(exit);
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return { functions: withOccurrences(opened), errors };
        ancestors.pop();
        leave(exits.pop() as Exit);
      }
    }
  } finally {
    cursor.delete();
  }

  function leave(exit: Exit): void {
    if (exit.frame) frames.pop();
    if (exit.scope) names.pop();
    if (exit.error) inError--;
  }
}

/** An `ERROR` or a `MISSING` node, unless `rules` read it as a gap of the grammar. */
function isError(cursor: TreeCursor, rules: CountRules): boolean {
  if (cursor.nodeIsMissing) return true;
  return cursor.nodeType === "ERROR" && !rules.grammarGap(cursor.currentNode);
}

/** D2: each function's 0-based index among the file's functions of the same qualified name. */
function withOccurrences(opened: readonly Open[]): FunctionCount[] {
  const seen = new Map<string, number>();
  return opened.map((open) => {
    const occurrence = seen.get(open.qualifiedName) ?? 0;
    seen.set(open.qualifiedName, occurrence + 1);
    return {
      qualifiedName: open.qualifiedName,
      occurrence,
      range: open.range,
      bodyHash: open.bodyHash,
      complexity: open.complexity,
      decisions: open.decisions,
    };
  });
}

/** 1-based, the end just after the last character (`CodeRange`). */
function rangeAt(cursor: TreeCursor): CodeRange {
  const start = cursor.startPosition;
  const end = cursor.endPosition;
  return {
    startLine: start.row + 1,
    startColumn: start.column + 1,
    endLine: end.row + 1,
    endColumn: end.column + 1,
  };
}

/** D2: the text with every whitespace character removed, so a reindent or a reflow keeps it. */
function bodyHash(text: string, from: number, to: number): string {
  const normalised = text.slice(from, to).replace(/\s+/g, "");
  return createHash("sha1").update(normalised).digest("hex").slice(0, 16);
}
