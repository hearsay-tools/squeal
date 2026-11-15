import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "acorn";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

/*
 * Row 011-352 (card 7, `research/scheduler-step.md`, "The wake loop"): work
 * the scheduler starts and nobody awaits is counted by its wake loop
 * (`Wakes.track`), so `rest` sees it. A bare `void` of a call, or a detached
 * `.catch(`/`.then(`/`.finally(` on work started in the same statement, is
 * work no one counts; so is work started into a local whose only uses are
 * such handler statements, or none (review 0.1.513 S1). The guarantee is
 * syntactic: any other use of the local (an await, a return, an argument)
 * counts as its consumer; the check does not follow it further. Types are
 * stripped with esbuild and the code parsed with acorn, so comments,
 * strings and type positions are not read.
 */

const DIR = join(import.meta.dirname, "../../src/core/scheduler");

/** Owners outside the wake loop: cards 9 and 10 (the busy store's resume, a remote run's permits). */
const OUTSIDE = new Set(["busy-resume.ts", "local-permits.ts"]);

/** A `void` of a call that starts no scheduler work, each with its reason. */
const ALLOWED: readonly { file: string; call: string; why: string }[] = [
  { file: "mutex.ts", call: "this.#watchers.delete", why: "a Set's delete: no promise" },
  {
    file: "request-intake-requests.ts",
    call: "passes.pass().catch",
    why: "the lint pass's own work (spec 017), which its pass tracks, not the scheduler's",
  },
];

type Node = { type: string; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

/** `this.#lock.run().catch` for a callee: members and calls, as written. */
function path(node: unknown): string {
  if (!isNode(node)) return "?";
  switch (node.type) {
    case "ThisExpression":
      return "this";
    case "Identifier":
      return String(node.name);
    case "PrivateIdentifier":
      return `#${String(node.name)}`;
    case "ChainExpression":
      return path(node.expression);
    case "CallExpression":
      return `${path(node.callee)}()`;
    case "MemberExpression":
      return `${path(node.object)}.${path(node.property)}`;
    default:
      return node.type;
  }
}

const unchain = (node: unknown): unknown =>
  isNode(node) && node.type === "ChainExpression" ? node.expression : node;

function walk(
  node: unknown,
  visit: (node: Node, parents: readonly Node[]) => void,
  parents: Node[] = [],
): void {
  if (Array.isArray(node)) for (const item of node) walk(item, visit, parents);
  else if (isNode(node)) {
    visit(node, parents);
    parents.push(node);
    for (const [key, value] of Object.entries(node))
      if (key !== "type") walk(value, visit, parents);
    parents.pop();
  }
}

const HANDLERS = new Set(["catch", "then", "finally"]);
const SCOPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "Program",
]);

/**
 * Whether the use of a local at `parents.at(-1)`'s child is only a handler
 * chain in a statement of its own (`p.catch(report);`), which consumes nothing.
 */
function handlerOnly(use: Node, parents: readonly Node[]): boolean {
  let node: Node = use;
  let at = parents.length - 1;
  for (;;) {
    const member = parents[at];
    const call = parents[at - 1];
    if (member?.type !== "MemberExpression" || member.object !== node) break;
    if (!HANDLERS.has(path(member.property))) return false;
    if (call?.type !== "CallExpression" || call.callee !== member) return false;
    node = call;
    at -= 2;
  }
  return node !== use && parents[at]?.type === "ExpressionStatement";
}

/** The uses of `name` under `scope`, each with its parents; not the binding, a property name or a key. */
function usesOf(scope: Node, name: string, binding: Node): { node: Node; parents: Node[] }[] {
  const uses: { node: Node; parents: Node[] }[] = [];
  walk(scope, (node, parents) => {
    if (node === binding || node.type !== "Identifier" || node.name !== name) return;
    const parent = parents.at(-1);
    if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return;
    if (parent?.type === "Property" && parent.key === node && !parent.shorthand) return;
    uses.push({ node, parents: [...parents] });
  });
  return uses;
}

/** Review 0.1.513 S1: work started into a local that only gets handlers, or nothing, is not consumed. */
function unconsumed(node: Node, parents: readonly Node[]): string | null {
  if (node.type !== "VariableDeclarator" || !isNode(node.id) || node.id.type !== "Identifier")
    return null;
  const init = unchain(node.init);
  if (!isNode(init) || init.type !== "CallExpression") return null;
  const scope = [...parents].reverse().find((parent) => SCOPES.has(parent.type));
  const name = String(node.id.name);
  const uses = scope === undefined ? [] : usesOf(scope, name, node.id);
  return uses.every((use) => handlerOnly(use.node, use.parents))
    ? `const ${name} = ${path(init.callee)}()`
    : null;
}

/** A `void` of a call that hands nothing to `*.track`. */
function voided(node: Node): string | null {
  if (node.type !== "UnaryExpression" || node.operator !== "void") return null;
  const argument = unchain(node.argument);
  if (!isNode(argument) || argument.type !== "CallExpression") return null;
  const call = path(argument.callee);
  return call.endsWith(".track") ? null : `void ${call}`;
}

/** A statement of only a handler chain on work it started (`start().catch(report);`). */
function detached(node: Node): string | null {
  if (node.type !== "ExpressionStatement") return null;
  const expression = unchain(node.expression);
  if (!isNode(expression) || expression.type !== "CallExpression") return null;
  const callee = unchain(expression.callee);
  if (!isNode(callee) || callee.type !== "MemberExpression") return null;
  // On a promise held elsewhere (`ended.catch(() => {})`) it only marks a rejection handled.
  const started = isNode(unchain(callee.object)) && path(callee.object).endsWith(")");
  return HANDLERS.has(path(callee.property)) && started ? path(callee) : null;
}

/** The untracked work in `source`: each as the call it voids, detaches or leaves unconsumed. */
function untracked(source: string): string[] {
  const { code } = transformSync(source, { loader: "ts", target: "esnext" });
  const found: string[] = [];
  walk(parse(code, { ecmaVersion: "latest", sourceType: "module" }), (node, parents) => {
    for (const hit of [unconsumed(node, parents), voided(node), detached(node)])
      if (hit !== null) found.push(hit);
  });
  return found;
}

describe("no untracked background promise in the scheduler (row 011-352)", () => {
  it("finds a bare void and a detached catch, and passes tracked work and a handled mark", () => {
    const source = `
      class A {
        #wakes: { track<T>(p: Promise<T>): Promise<T> } = { track: (p) => p };
        async #release(lane: string): Promise<void> {}
        go(ended: Promise<void>): void {
          void this.#release("a");
          this.#release("b").catch((error: unknown) => {});
          void this.#wakes.track(this.#release("c"));
          ended.catch(() => {});
          const kept = this.#release("d").catch(() => {});
          const started = this.#release("e");
          started.catch(() => {});
          const counted = this.#release("f");
          counted.catch(() => {});
          void this.#wakes.track(counted);
          // void this.#release("in a comment");
          const text = "void this.#release()";
          const f = (): void => {};
        }
      }`;
    expect(untracked(source)).toEqual([
      "void this.#release",
      "this.#release().catch",
      "const kept = this.#release().catch()",
      "const started = this.#release()",
    ]);
  });

  it("holds for every module under src/core/scheduler but cards 9 and 10's", () => {
    const found: string[] = [];
    for (const file of readdirSync(DIR)
      .filter((name) => name.endsWith(".ts"))
      .sort()) {
      if (OUTSIDE.has(file)) continue;
      const allowed = new Set(ALLOWED.filter((a) => a.file === file).map((a) => `void ${a.call}`));
      for (const call of untracked(readFileSync(join(DIR, file), "utf8")))
        if (!allowed.has(call)) found.push(`${file}: ${call}`);
    }
    expect(found).toEqual([]);
  });
});
