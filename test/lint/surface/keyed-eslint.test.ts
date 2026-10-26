import { describe, expect, it } from "vitest";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import { lintLines } from "../../../src/core/lint/surface/format.js";
import type { LintFinding } from "../../../src/core/types/lint.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir } from "../helpers.js";
import { daemon } from "../integration/helpers.js";
import { cli, install, type Major } from "../provider/helpers.js";
import { consumer, ownAfter, said, sourceOf } from "./helpers.js";

/*
 * Review 0.1.360 B1 with ESLint's core rules, on ESLint 9 and 10 and the
 * real provider and pass: a finding the old config gave is not told as the
 * file's change once the config changed; the summary is, and an edit after
 * the keying is told with its own finding. Each stored result is checked
 * against a fresh `eslint -f json` before the news is read.
 */

const config = (rules: Record<string, string>) =>
  `export default [{ ignores: ["eslint.config.js"] }, { rules: ${JSON.stringify(rules)} }];\n`;
const OLD = config({ "no-console": "warn", "no-unused-vars": "off" });
const NEW = config({ "no-console": "off", "no-unused-vars": "error" });
const SUMMARY = "Lint config changed: 1 file with findings now; squeal lint lists them.";

const pairs = (findings: readonly LintFinding[] | undefined) =>
  (findings ?? []).map((f) => `${f.rule}|${f.message}`);

/**
 * Revision 1: `src/a.js` passes under `OLD`, and the consumer registers.
 * Revision 2: the session's edit adds `console.log`, a `no-console`
 * finding, not delivered. Revision 3: only the config changes, to `NEW`.
 */
async function acrossConfig(major: Major) {
  const tree = new FakeWorktree("w1", commonDir());
  tree.write("package.json", '{ "type": "module" }\n');
  tree.write("eslint.config.js", OLD);
  tree.write("src/a.js", "const count=1;\n");
  install(tree.root, "core-rules", major);
  tree.revise();
  const lint = daemon(tree);
  expect((await lint.run("src/a.js")).state?.outcome).toBe("pass");
  const source = sourceOf(tree);
  const me = consumer(tree);
  expect(registerLint(source, me, 5_000)).toEqual({ v: 1, failing: 0, stale: 0 });

  /** Writes `path`, makes a revision and runs the pass: the stored result equals ESLint's own. */
  const step = async (path: string, text: string) => {
    tree.write(path, text);
    tree.revise();
    const after = await lint.run("src/a.js");
    const fresh = cli(tree.root, ["src/a.js"]).get("src/a.js");
    const findings = fresh !== undefined && "findings" in fresh ? fresh.findings : undefined;
    expect(after.rules?.map((r, i) => `${r}|${after.messages?.[i]}`)).toEqual(pairs(findings));
    return findings ?? [];
  };
  expect(
    (await step("src/a.js", 'const count=1;\nconsole.log("x");\n')).map((f) => f.rule),
  ).toEqual(["no-console"]);
  expect((await step("eslint.config.js", NEW)).map((f) => f.rule)).toEqual(["no-unused-vars"]);
  return { source, me, step, close: () => lint.close(), since: () => ownAfter(1) };
}

/** The line ESLint's `no-unused-vars` finding for `other` is told with. */
function unusedOther(findings: readonly LintFinding[]): string {
  const other = findings.find((f) => f.message.includes("'other'"));
  expect(other?.rule).toBe("no-unused-vars");
  return `FAIL lint: src/a.js: 2 findings, +1 no-unused-vars (${other?.message})`;
}

describe.each([9, 10] as const)(
  "lint news across a config change, ESLint %i (review 0.1.360 B1)",
  (major) => {
    it("tells the summary only, then a genuine edit after the keying", async () => {
      const { source, me, step, close, since } = await acrossConfig(major);
      const news = tellLint(source, me, 5_100, since);
      expect(news?.entries).toEqual([]);
      expect(lintLines(news ?? expect.unreachable(), "squeal")).toEqual([SUMMARY]);
      expect(tellLint(source, me, 5_200, since)).toBeNull();

      const now = await step("src/a.js", 'const count=1;\nconsole.log("x");\nconst other=2;\n');
      const edit = tellLint(source, me, 5_300, since);
      expect(edit?.entries.map(said)).toEqual(["fail-changed src/a.js +no-unused-vars"]);
      expect(pairs(edit?.entries[0]?.added)).toEqual(
        pairs(now).filter((p) => p.includes("'other'")),
      );
      expect(lintLines(edit ?? expect.unreachable(), "squeal")).toEqual([unusedOther(now)]);
      await close();
    }, 120_000);

    it("tells an edit after the keying beside the summary, with its own finding only", async () => {
      const { source, me, step, close, since } = await acrossConfig(major);
      const now = await step("src/a.js", 'const count=1;\nconsole.log("x");\nconst other=2;\n');
      const news = tellLint(source, me, 5_100, since);
      expect(news?.entries.map(said)).toEqual(["pass-to-fail src/a.js +no-unused-vars"]);
      // Every finding the news names is in the file's result now.
      for (const entry of news?.entries ?? []) {
        for (const added of pairs(entry.added)) expect(pairs(now)).toContain(added);
      }
      expect(lintLines(news ?? expect.unreachable(), "squeal")).toEqual([
        SUMMARY,
        unusedOther(now),
      ]);
      expect(tellLint(source, me, 5_200, since)).toBeNull();
      await close();
    }, 120_000);
  },
);
