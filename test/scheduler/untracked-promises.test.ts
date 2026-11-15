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
 * work no one counts. Types are stripped with esbuild and the code parsed
 * with acorn, so comments, strings and type positions are not read.
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

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) for (const item of node) walk(item, visit);
  else if (isNode(node)) {
    visit(node);
    for (const [key, value] of Object.entries(node)) if (key !== "type") walk(value, visit);
  }
}

/** The untracked work in `source`: each as the call it voids or detaches. */
function untracked(source: string): string[] {
  const { code } = transformSync(source, { loader: "ts", target: "esnext" });
  const found: string[] = [];
  walk(parse(code, { ecmaVersion: "latest", sourceType: "module" }), (node) => {
    if (node.type === "UnaryExpression" && node.operator === "void") {
      const argument = unchain(node.argument);
      if (!isNode(argument) || argument.type !== "CallExpression") return;
      const call = path(argument.callee);
      if (!call.endsWith(".track")) found.push(`void ${call}`);
    }
    if (node.type === "ExpressionStatement") {
      const expression = unchain(node.expression);
      if (!isNode(expression) || expression.type !== "CallExpression") return;
      const callee = unchain(expression.callee);
      if (!isNode(callee) || callee.type !== "MemberExpression") return;
      const handler = path(callee.property);
      // On a promise held elsewhere (`ended.catch(() => {})`) it only marks a rejection handled.
      const started = isNode(unchain(callee.object)) && path(callee.object).endsWith(")");
      if (["catch", "then", "finally"].includes(handler) && started) found.push(path(callee));
    }
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
          // void this.#release("in a comment");
          const text = "void this.#release()";
          const f = (): void => {};
        }
      }`;
    expect(untracked(source)).toEqual(["void this.#release", "this.#release().catch"]);
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
