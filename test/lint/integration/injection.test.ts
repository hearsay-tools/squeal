import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { after, daemon, fixture, narrowed } from "./helpers.js";

/*
 * Wave 1.7's edit injection with the real provider and pass: an unlisted
 * rule and an unlisted program file change once, between the worker's
 * reads and the pass's looks: after a provider call returns, or inside the
 * install callback. Every result the pass stores holds fresh ESLint's
 * findings at its key's bytes: a clean root at the bytes before or after
 * the edit gets fresh ESLint's findings, from its own lint or from a
 * stored result. In C1's shape the rule is also a program file: ESLint
 * keeps the module it loaded while TypeScript reads the rule's new bytes.
 */

const RULE = "eslint/rules/no-foo.js";
const PROGRAM = "src/u.ts";
const FILES = ["src/a.js", "src/t.ts"];

const rule = (version: number) =>
  `export default {
  meta: { type: "problem", schema: [] },
  create(context) {
    return { Program(node) { context.report({ node, message: "rule ${version}" }); } };
  },
};
`;
const program = (version: number) =>
  version === 0
    ? "export function load(): number {\n  return 1;\n}\n"
    : "export function load(): Promise<number> {\n  return Promise.resolve(1);\n}\n";

/** C1: the tsconfig takes the rule into the program beside `t.ts`. */
const IN_PROGRAM = (text: string) =>
  narrowed("tsconfig.json", text)
    .replace('"noEmit": true', '"noEmit": true, "allowJs": true')
    .replace('"src/t.ts"', `"src/t.ts", "${RULE}"`);

/**
 * The project fixture with the rule and the program file at `version`,
 * both outside the listing; with `inProgram` the rule is a program file too.
 */
function rooted(id: string, dir: string, version: number, inProgram: boolean): FakeWorktree {
  const tree = new FakeWorktree(id, dir);
  const text = (path: string, given: string) =>
    path === RULE
      ? rule(version)
      : path === PROGRAM
        ? program(version)
        : inProgram && path === "tsconfig.json"
          ? IN_PROGRAM(given)
          : narrowed(path, given);
  fixture(tree, "project", text, [RULE, PROGRAM]);
  return tree;
}

const fresh = (tree: FakeWorktree, path: string) => {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : [];
};

describe.each([
  ["outside the program", false],
  ["also a program file (C1)", true],
])(
  "an edit between the worker's reads and the pass's looks, the rule %s (wave 1.7)",
  (_, inProgram) => {
    it.each(["install", "open", "refresh", "inputs", "lint"])(
      "after the first %s: every stored result is fresh ESLint's at its key's bytes",
      async (at) => {
        const dir = commonDir();
        const tree = rooted("w1", dir, 0, inProgram);
        let edited = false;
        const edit = (call: string) => {
          if (edited || call !== at) return;
          edited = true;
          writeFileSync(join(tree.root, RULE), rule(1));
          writeFileSync(join(tree.root, PROGRAM), program(1));
        };
        const installed = () => {
          edit("install");
          return Promise.resolve("install-1");
        };
        const one = daemon(tree, installed, (made) => after(made, edit));
        for (const path of FILES) await one.run(path);
        expect(edited).toBe(true);

        // A revision that names no input, once a look again is due: fresh ESLint's findings.
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        tree.write("README.md", "# settled\n");
        tree.revise();
        for (const path of FILES) {
          const settled = await one.run(path);
          expect(settled.state, path).toMatchObject({ stale: false });
          expect(settled.messages, path).toEqual(fresh(tree, path));
        }
        await one.close();

        // A clean root at the bytes before the edit and one at the bytes after it.
        for (const version of [0, 1]) {
          const root = rooted(`clean${version}`, dir, version, inProgram);
          const other = daemon(root);
          for (const path of FILES) {
            expect((await other.run(path)).messages, `${version} ${path}`).toEqual(
              fresh(root, path),
            );
          }
          await other.close();
        }
      },
      180_000,
    );
  },
);
