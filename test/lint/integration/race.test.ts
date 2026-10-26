import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { after, daemon, fixture, narrowed, onDisk } from "./helpers.js";

/*
 * Wave 1.7 P2 with the real provider and pass: a listed program file is
 * saved, and TypeScript reads the saved bytes before the revision that
 * lists them comes. The key holds the listed blob: the pass stores nothing
 * for that lint. It has no text at the listed blob to feed, the disk holds
 * the saved bytes, so it stores nothing until that revision. Every stored
 * result is fresh ESLint's at its key's bytes.
 */

const PROGRAM = "src/u.ts";
const FLOATING = "Promises must be awaited";

const program = (version: number) =>
  version === 0
    ? "export function load(): number {\n  return 1;\n}\n"
    : "export function load(): Promise<number> {\n  return Promise.resolve(1);\n}\n";

/** The typed project, everything listed, `u.ts` at `version`. */
function rooted(id: string, dir: string, version: number): FakeWorktree {
  const tree = new FakeWorktree(id, dir);
  fixture(tree, "project", (path, text) =>
    path === PROGRAM ? program(version) : narrowed(path, text),
  );
  return tree;
}

const fresh = (tree: FakeWorktree, path: string) => {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : [];
};

describe("a listed program file saved before the revision that lists it (wave 1.7 P2)", () => {
  it("stores nothing for TypeScript's read of the saved bytes, then each revision's fresh findings", async () => {
    const dir = commonDir();
    const tree = rooted("w1", dir, 0);
    const listed = rooted("clean0", dir, 0);
    const atListed = fresh(listed, "src/t.ts");
    expect(atListed.join()).not.toContain(FLOATING);
    // Saved after the pass keyed the part and before the worker lints it.
    let saved = false;
    const save = (call: string) => {
      if (saved || call !== "inputs") return;
      saved = true;
      onDisk(tree, PROGRAM, program(1));
    };
    const one = daemon(tree, undefined, (made) => after(made, save));
    const first = await one.run("src/t.ts");
    expect(saved).toBe(true);
    if (first.messages !== undefined) expect(first.messages).toEqual(atListed);

    // A look again before the revision comes: still nothing, or fresh ESLint's at the listed bytes.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    tree.write("README.md", "# saved\n");
    tree.revise();
    const waiting = await one.run("src/t.ts");
    if (waiting.messages !== undefined) expect(waiting.messages).toEqual(atListed);

    // The revision that lists the saved bytes.
    tree.write(PROGRAM, program(1));
    tree.revise();
    const saves = await one.run("src/t.ts");
    expect(saves.messages?.join()).toContain(FLOATING);
    expect(saves.messages).toEqual(fresh(tree, "src/t.ts"));
    await one.close();

    // A clean root at each of the two bytes.
    for (const root of [listed, rooted("clean1", dir, 1)]) {
      const other = daemon(root);
      expect((await other.run("src/t.ts")).messages, root.id).toEqual(fresh(root, "src/t.ts"));
      await other.close();
    }
  }, 180_000);
});
