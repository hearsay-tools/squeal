import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon, fixture, onDisk } from "./helpers.js";

/*
 * Wave 1.8 with the real provider and pass: a plugin reads `data.txt` in
 * a worker thread it starts and waits on, as synckit's plugins do
 * (eslint-plugin-prettier reads `.prettierrc` that way). The observer does
 * not see that thread's reads, so once ESLint code started one, nothing the
 * lint thread lints is stored: each file reads unknown and says why.
 */

const REASON = "ESLint ran code in a worker thread Squeal cannot observe (eslint-plugin-sync)";
const PREFER_CONST = "'a' is never reassigned. Use 'const' instead.";
/** The fixture's config without the plugin. */
const WITHOUT = `export default [
  { ignores: ["eslint.config.js"] },
  { rules: { "prefer-const": "error" } },
];
`;

const messages = (tree: FakeWorktree, path: string) => {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : [];
};

describe.each([9, 10] as const)(
  "ESLint %i: a plugin reads a file in a worker thread it starts (wave 1.8)",
  (major) => {
    it("each root of one store reads unknown with the reason, never a shared hit", async () => {
      const dir = commonDir();
      for (const [id, data] of [
        ["w1", "before"],
        ["w2", "after"],
      ] as const) {
        const tree = new FakeWorktree(id, dir);
        fixture(tree, "worker", undefined, [], major);
        onDisk(tree, "data.txt", data);
        const one = daemon(tree);
        const got = await one.run("src/a.js");
        await one.close();
        expect(messages(tree, "src/a.js").sort(), id).toEqual([data, PREFER_CONST].sort());
        expect(got.messages, id).toBeUndefined();
        expect(got.state, id).toMatchObject({ outcome: "unknown", stale: false, reason: REASON });
        expect(
          one.reports.reduce((hits, report) => hits + report.hits, 0),
          id,
        ).toBe(0);
      }
    }, 180_000);

    it("a config without that plugin still stores", async () => {
      const tree = new FakeWorktree("w1", commonDir());
      fixture(
        tree,
        "worker",
        (path, text) => (path === "eslint.config.js" ? WITHOUT : text),
        [],
        major,
      );
      const one = daemon(tree);
      const got = await one.run("src/a.js");
      await one.close();
      expect(got.state).toMatchObject({ outcome: "fail", stale: false });
      expect(got.messages).toEqual(messages(tree, "src/a.js"));
      expect(got.messages).toEqual([PREFER_CONST]);
    }, 180_000);
  },
);
