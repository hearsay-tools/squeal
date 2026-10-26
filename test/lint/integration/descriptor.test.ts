import { describe, expect, it } from "vitest";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { cli } from "../provider/helpers.js";
import { daemon, fixture, onDisk } from "./helpers.js";

/*
 * Review 0.1.353 B1-R4 with the real provider and pass: a local rule reads
 * `data.txt`, outside the listing, through a descriptor it opened `a+`.
 * Two roots differ only in that file's bytes and share one lint store. The
 * worker cannot hash a descriptor's read: each root stores fresh ESLint's
 * findings, or nothing.
 */

const RULE = `import fs from "node:fs";

export default {
  meta: { schema: [] },
  create(context: { report(report: object): void }) {
    return {
      Program(node: object) {
        const fd = fs.openSync(new URL("./data.txt", import.meta.url), "a+");
        let text: string;
        try {
          text = fs.readFileSync(fd, "utf8");
        } finally {
          fs.closeSync(fd);
        }
        context.report({ node, message: text });
      },
    };
  },
};
`;

const messages = (tree: FakeWorktree, path: string) => {
  const result = cli(tree.root, [path]).get(path);
  return result !== undefined && "findings" in result ? result.findings.map((f) => f.message) : [];
};

describe.each([9, 10] as const)(
  "ESLint %i: a rule reads a file through a descriptor opened a+ (review 0.1.353 B1-R4)",
  (major) => {
    it("each root of one store gets fresh ESLint's findings, or nothing is stored", async () => {
      const dir = commonDir();
      for (const [id, data] of [
        ["w1", "before"],
        ["w2", "after"],
      ] as const) {
        const tree = new FakeWorktree(id, dir);
        fixture(tree, "ts-config", (path, text) => (path === "rule.ts" ? RULE : text), [], major);
        onDisk(tree, "data.txt", data);
        const one = daemon(tree);
        const got = await one.run("src/a.js");
        await one.close();
        const fresh = messages(tree, "src/a.js");
        expect(fresh, id).toEqual([data, "inline before"]);
        if (got.messages !== undefined) expect(got.messages, id).toEqual(fresh);
        else {
          // Nothing stored: the file reads unknown and says why.
          expect(got.state, id).toMatchObject({ outcome: "unknown", stale: false });
          expect(got.state?.reason, id).toContain("data.txt");
        }
      }
    }, 180_000);
  },
);
