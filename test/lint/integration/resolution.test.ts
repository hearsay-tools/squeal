import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon, fixture, narrowed, onDisk } from "./helpers.js";

/*
 * Wave 1.7 Q1 and Q3 with the real provider and pass: a generated file
 * appears outside the listing. The pass sees the folder the program's
 * lookups read move, reads the program again, and a kept import that now
 * resolves to the new file starts a new worker; a file the tsconfig's
 * include takes in joins the program. The next result is fresh ESLint's.
 */

const FLOATING = "Promises must be awaited";

/** `t.ts` calls `load` unawaited: a floating promise once `load`'s type is known. */
const SHAPES = {
  imported: {
    edit: narrowed,
    t: 'import { load } from "./gen.js";\n\nexport function run(): void {\n  load();\n}\n',
    gen: "export function load(): Promise<number> {\n  return Promise.resolve(1);\n}\n",
  },
  included: {
    edit: (_: string, text: string) => text,
    t: "export function run(): void {\n  load();\n}\n",
    gen: "declare global {\n  function load(): Promise<number>;\n}\n\nexport {};\n",
  },
} as const;

const messages = (tree: FakeWorktree, path: string) => {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : [];
};

describe.each(Object.entries(SHAPES))(
  "a generated file %s appears outside the listing (Q1, Q3)",
  (_, shape) => {
    it.each([
      ["with no revision", false],
      ["at a revision that names no input", true],
    ])(
      "%s: the next result is fresh ESLint's",
      async (_, revise) => {
        const tree = new FakeWorktree("w1", commonDir());
        fixture(tree, "project", (path, text) =>
          path === "src/t.ts" ? shape.t : shape.edit(path, text),
        );
        const one = daemon(tree);
        const before = await one.run("src/t.ts");
        expect(before.messages).toEqual(messages(tree, "src/t.ts"));
        expect(before.messages?.join()).not.toContain(FLOATING);

        onDisk(tree, "src/gen.ts", shape.gen);
        if (revise) {
          tree.write("README.md", "# generated\n");
          tree.revise();
        }
        const after = await one.run("src/t.ts");
        const fresh = messages(tree, "src/t.ts");
        expect(fresh.join()).toContain(FLOATING);
        expect(after.state).toMatchObject({ stale: false });
        expect(after.messages).toEqual(fresh);
        await one.close();
      },
      180_000,
    );
  },
);
