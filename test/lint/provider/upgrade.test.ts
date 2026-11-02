import { describe, expect, it } from "vitest";
import type {
  LintDeclaration,
  LintFileResult,
  LintOff,
  LintProvider,
} from "../../../src/core/lint/pass/index.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { daemon } from "../integration/helpers.js";
import { cli, install } from "./helpers.js";

/*
 * Review 0.1.392 B1: row 017-27 changes what the worker reports for a rule
 * that probes a relative path, so it raises `PROVIDER_VERSION` (D5). A
 * result 0.1.391's worker stored at the same bytes keys under the old
 * version: the new pass misses it, lints, and stores the CLI's result.
 */

/** `PROVIDER_VERSION` as 0.1.391 released it, before row 017-27. */
const RELEASED = 5;

/** A rule that reports when `marker.txt` is in the process directory, as the review's probe. */
const CONFIG = `import { existsSync } from "node:fs";

const rule = {
  meta: { schema: [] },
  create(context) {
    return {
      Program(node) {
        if (existsSync("marker.txt")) context.report({ node, message: "marker exists" });
      },
    };
  },
};

export default [{ plugins: { probe: { rules: { r: rule } } }, rules: { "probe/r": "error" } }];
`;

/**
 * The 0.1.391 worker over `made`: version 5, and `probe/r` never found,
 * since its relative `existsSync` looked in the daemon's directory.
 */
function released(made: LintProvider): LintProvider {
  const declared = <T extends LintDeclaration | LintOff>(answer: T): T =>
    "off" in answer ? answer : { ...answer, providerVersion: RELEASED };
  const old = (result: LintFileResult): LintFileResult =>
    "findings" in result
      ? { findings: result.findings.filter((f) => f.rule !== "probe/r") }
      : result;
  return {
    open: async (format) => declared(await made.open(format)),
    refresh: async (level) => {
      const snapshot = await made.refresh(level);
      return "off" in snapshot
        ? snapshot
        : { ...snapshot, declaration: declared(snapshot.declaration) };
    },
    inputs: (paths) => made.inputs(paths),
    lint: async (files) => {
      const report = await made.lint(files);
      if ("off" in report) return report;
      const results = new Map([...report.results].map(([path, r]) => [path, old(r)]));
      return { ...report, results };
    },
    close: () => made.close(),
  };
}

describe("an upgrade over 0.1.391's results (review 0.1.392 B1)", () => {
  it("misses a result the released worker stored at the same bytes, and stores the CLI's", async () => {
    const tree = new FakeWorktree("w1", commonDir());
    tree.write("package.json", '{ "type": "module" }\n');
    tree.write("eslint.config.js", CONFIG);
    tree.write("marker.txt", "");
    tree.write("src/a.js", "export const a = 1;\n");
    install(tree.root, "hazard", 10);
    tree.revise();

    const before = daemon(tree, undefined, released);
    const seeded = await before.run("src/a.js");
    await before.close();
    expect(seeded.state?.judged?.outcome).toBe("pass");
    expect(seeded.rules).toEqual([]);

    const now = daemon(tree);
    const after = await now.run("src/a.js");
    await now.close();
    const expected = cli(tree.root, ["src/a.js"]).get("src/a.js");
    expect(expected).toEqual({ findings: [expect.objectContaining({ rule: "probe/r" })] });
    expect(after.state?.judged?.key).not.toBe(seeded.state?.judged?.key);
    expect(after.state?.judged?.outcome).toBe("fail");
    expect(after.rules).toEqual(["probe/r"]);
    expect(after.messages).toEqual(["marker exists"]);
  }, 60_000);
});
