import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintCheck } from "../../../src/core/lint/pass/judge.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { revise, seed } from "../../status/slow-tier-seed.js";
import { lintPass, storeOf } from "../pass/helpers.js";
import { cli, install, type Major, provider } from "../provider/helpers.js";
import { deliveryOf, LINT_POLICY, runLint } from "../wiring/rig.js";

/*
 * Review 0.1.360 B2 with the real provider, ESLint 9 and 10 and their core
 * rules: a config change judges `src/a.js` again with no transition (D2),
 * and `squeal lint --changed` tells the session's change as history, then
 * the file's result now. Each stored result equals a fresh `eslint -f json`.
 */

const passes: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const pass of passes.splice(0)) await pass.close();
});

/** A flat config with `rules`, which does not lint itself. */
const config = (rules: Record<string, string>) =>
  `export default [{ ignores: ["eslint.config.js"] }, { rules: ${JSON.stringify(rules)} }];\n`;

/**
 * A repository as `wiredRig` makes it, linted by the real pass and provider
 * with ESLint `major`: each write goes to the tree the pass reads and the
 * worktree `squeal lint` reads.
 */
async function eslintRig(major: Major, files: Record<string, string>) {
  const s = seed(LINT_POLICY, { revisions: 1, changes: Object.keys(files), alive: false });
  const tree = new FakeWorktree(s.repo.mainId, s.repo.commonDir);
  const write = (path: string, text: string) => {
    tree.write(path, text);
    mkdirSync(dirname(join(s.repo.main, path)), { recursive: true });
    writeFileSync(join(s.repo.main, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  // No fixture's packages: ESLint and its toolchain only.
  install(tree.root, "none", major);
  tree.revise();
  const run = lintPass(tree, provider(tree.root));
  passes.push(run.pass);
  const settle = async () => {
    run.pass.nudge();
    await run.pass.idle();
    expect(run.errors).toEqual([]);
  };
  await settle();
  const rig = {
    ...s,
    async edit(changed: Record<string, string>) {
      for (const [path, text] of Object.entries(changed)) write(path, text);
      tree.revise();
      revise(s.store, s.repo, Object.keys(changed));
      await settle();
    },
    /** `src/a.js`'s stored findings, which a fresh ESLint run must give too, as `rule message`. */
    findings() {
      const state = storeOf(tree).states.list(tree.id, { paths: ["src/a.js"] })[0];
      const key = state?.judged?.key ?? expect.unreachable();
      const stored = storeOf(tree).results.get(lintCheck("src/a.js"), key)?.findings ?? [];
      const fresh = cli(tree.root, ["src/a.js"]).get("src/a.js");
      const said = stored.map((f) => `${f.rule} ${f.message}`);
      expect(fresh !== undefined && "findings" in fresh ? fresh.findings : null).toEqual(stored);
      return said;
    },
    async changed() {
      const env = { CLAUDE_CODE_SESSION_ID: "s1" };
      const { code, out } = await runLint(s.repo.main, ["--changed"], env);
      expect(code).toBe(0);
      return out;
    },
  };
  await deliveryOf(s).register({ worktreeId: s.repo.mainId, sessionId: "s1", agentId: "main" });
  return rig;
}

const HEAD = "Lint: 1 file changed since this session started";
const UNUSED = "no-unused-vars 'count' is assigned a value but never used.";
const CONSOLE = "no-console Unexpected console statement.";

describe.each([9, 10] as const)(
  "squeal lint --changed after a config change, ESLint %i",
  (major) => {
    it("case A: a PASS change the config made fail since says it fails now", async () => {
      const rig = await eslintRig(major, {
        "eslint.config.js": config({ "no-unused-vars": "error", "no-console": "off" }),
        "src/a.js": 'const count=1;\nconsole.log("x");\n',
      });
      expect(rig.findings()).toEqual([UNUSED]);
      await rig.edit({ "src/a.js": 'console.log("x");\n' });
      expect(rig.findings()).toEqual([]);
      // Control: the PASS is the result now.
      expect(await rig.changed()).toBe(
        `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2\n`,
      );
      await rig.edit({
        "eslint.config.js": config({ "no-unused-vars": "error", "no-console": "warn" }),
      });
      expect(rig.findings()).toEqual([CONSOLE]);
      expect(await rig.changed()).toBe(
        `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now fail: 1 finding, linted at revision 3\n`,
      );
    }, 60_000);

    it("a FAIL change the config judged again with another rule, the same count, is history", async () => {
      const rig = await eslintRig(major, {
        "eslint.config.js": config({ "no-console": "warn", "no-unused-vars": "off" }),
        "src/a.js": "const count=1;\n",
      });
      expect(rig.findings()).toEqual([]);
      await rig.edit({ "src/a.js": 'const count=1;\nconsole.log("x");\n' });
      expect(rig.findings()).toEqual([CONSOLE]);
      const change =
        "  FAIL lint: src/a.js: 1 finding, +1 no-console (Unexpected console statement.); at revision 2";
      // Control: the FAIL is the result now.
      expect(await rig.changed()).toBe(`${HEAD}\n${change}\n`);
      await rig.edit({
        "eslint.config.js": config({ "no-console": "off", "no-unused-vars": "error" }),
      });
      expect(rig.findings()).toEqual([UNUSED]);
      expect(await rig.changed()).toBe(
        `${HEAD}\n${change}; now fail: 1 finding, linted at revision 3\n`,
      );
    }, 60_000);
  },
);
