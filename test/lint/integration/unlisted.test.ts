import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon, fixture, narrowed } from "./helpers.js";

/*
 * Review 0.1.348-r2 with the real provider and pass (wave 1.6): a key input
 * outside the listing, a generated or git-ignored file, is read on disk at
 * each pass before any lookup. Its bytes enter the key, a change to it
 * refreshes the worker as a listed one does, and the worker lints with the
 * bytes the key holds.
 */

const FLOATING = ["@typescript-eslint/no-floating-promises"];

/** `t.ts` imports the generated `gen.ts`; both generated files are git-ignored and unlisted. */
function generated(tree: FakeWorktree, deep: string): void {
  tree.write(".gitignore", "node_modules/\nsrc/gen.ts\nsrc/deep.ts\n");
  fixture(tree, "project", (path, text) =>
    path === "src/t.ts" ? text.replace("./u.js", "./gen.js") : narrowed(path, text),
  );
  writeFileSync(
    join(tree.root, "src/gen.ts"),
    "export function load(): number {\n  return 1;\n}\n",
  );
  writeFileSync(join(tree.root, "src/deep.ts"), deep);
}

const deep = (returns: string, body: string) =>
  `export function value(): ${returns} {\n  return ${body};\n}\n`;

/** `gen.ts` gains an import of `deep.ts`, whose return type now decides `t.ts`'s findings. */
const GEN = 'import { value } from "./deep.js";\nexport function load() {\n  return value();\n}\n';

describe("an import added inside an unlisted program file (review 0.1.348-r2 B3-R)", () => {
  it.each([
    { after: "a README-only revision", revise: true },
    { after: "a nudge with no revision", revise: false },
  ])(
    "is in the keys of the pass after $after: no false shared pass",
    async ({ revise }) => {
      const dir = commonDir();
      const one = new FakeWorktree("w1", dir);
      const two = new FakeWorktree("w2", dir);
      generated(one, deep("number", "1"));
      generated(two, deep("Promise<number>", "Promise.resolve(1)"));
      const daemons = [daemon(one), daemon(two)] as const;
      for (const each of daemons) expect((await each.run()).state?.outcome).toBe("pass");

      for (const tree of [one, two]) {
        writeFileSync(join(tree.root, "src/gen.ts"), GEN);
        if (revise) {
          tree.write("README.md", "# fixture\n");
          tree.revise();
        }
      }
      const first = await daemons[0].run();
      expect(first.state).toMatchObject({ outcome: "pass", stale: false });
      const second = await daemons[1].run();
      expect(second.state?.judged?.key).not.toBe(first.state?.judged?.key);
      expect(second.state).toMatchObject({ outcome: "fail", stale: false });
      expect(second.rules).toEqual(FLOATING);
      expect(cli(two.root, ["src/t.ts"]).get("src/t.ts")).toMatchObject({
        findings: [expect.objectContaining({ rule: FLOATING[0] })],
      });
      for (const each of daemons) await each.close();
    },
    180_000,
  );
});

describe("a deleted unlisted program file (wave 1.6)", () => {
  it("moves the importer's key, and its findings are fresh ESLint's without the file", async () => {
    const tree = new FakeWorktree("w1", commonDir());
    generated(tree, deep("number", "1"));
    writeFileSync(
      join(tree.root, "src/gen.ts"),
      "export function load(): Promise<number> {\n  return Promise.resolve(1);\n}\n",
    );
    const pass = daemon(tree);
    const before = await pass.run();
    expect(before.state).toMatchObject({ outcome: "fail", stale: false });
    expect(before.rules).toEqual(FLOATING);

    rmSync(join(tree.root, "src/gen.ts"));
    const after = await pass.run();
    expect(after.state?.judged?.key).not.toBe(before.state?.judged?.key);
    expect(after.state?.stale).toBe(false);
    const fresh = cli(tree.root, ["src/t.ts"]).get("src/t.ts");
    const rules =
      fresh !== undefined && "findings" in fresh ? fresh.findings.map((f) => f.rule) : [];
    expect(rules).not.toEqual(FLOATING);
    expect(after.rules).toEqual(rules);
    await pass.close();
  }, 180_000);
});

describe("a config module outside the listing (review 0.1.348-r2 B2-R)", () => {
  /** The TS config fixture with `rule.ts` written on disk only, reporting `message`. */
  function unlistedRule(tree: FakeWorktree, message: string): void {
    fixture(
      tree,
      "ts-config",
      (path, text) => (path === "rule.ts" ? text.replace('"before"', `"${message}"`) : text),
      ["rule.ts"],
    );
  }

  it("its bytes are in the key: a second root whose rule differs lints with its own rule", async () => {
    const dir = commonDir();
    const one = new FakeWorktree("w1", dir);
    const two = new FakeWorktree("w2", dir);
    unlistedRule(one, "before");
    unlistedRule(two, "after");
    const first = daemon(one);
    const a = await first.run("src/a.js");
    expect(a.messages).toEqual(["before", "inline before"]);
    const second = daemon(two);
    const b = await second.run("src/a.js");
    expect(b.state?.judged?.key).not.toBe(a.state?.judged?.key);
    expect(b.messages).toEqual(["after", "inline before"]);
    await second.close();

    // Its edit alone, with no revision: a new worker loads it, and the file lints at a new key.
    writeFileSync(join(one.root, "rule.ts"), unlistedText("later"));
    const c = await first.run("src/a.js");
    expect(c.state?.judged?.key).not.toBe(a.state?.judged?.key);
    expect(c.messages).toEqual(["later", "inline before"]);
    await first.close();
  }, 180_000);
});

function unlistedText(message: string): string {
  return `export default {
  meta: { schema: [] },
  create(context: { report(report: object): void }) {
    return {
      Program(node: object) {
        context.report({ node, message: "${message}" });
      },
    };
  },
};
`;
}
