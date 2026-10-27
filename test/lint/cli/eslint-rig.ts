import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect } from "vitest";
import { blobHash } from "../../../src/core/hash/index.js";
import type {
  LintFile,
  LintFileInputs,
  LintRunReport,
  LintSnapshot,
} from "../../../src/core/lint/pass/index.js";
import { lintCheck } from "../../../src/core/lint/pass/judge.js";
import { lintKey, underModules } from "../../../src/core/lint/pass/keys.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { revise, seed } from "../../status/slow-tier-seed.js";
import { lintPass, storeOf } from "../pass/helpers.js";
import { cli, install, type Major, provider } from "../provider/helpers.js";
import { deliveryOf, LINT_POLICY, runLint } from "../wiring/rig.js";

const passes: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const pass of passes.splice(0)) await pass.close();
});

/** A flat config with `rules`, which does not lint itself. */
export const config = (rules: Record<string, string>) =>
  `export default [{ ignores: ["eslint.config.js"] }, { rules: ${JSON.stringify(rules)} }];\n`;

/**
 * A repository as `wiredRig` makes it, linted by the real pass and provider
 * with ESLint `major`: each write goes to the tree the pass reads and the
 * worktree `squeal lint` reads.
 */
export async function eslintRig(
  major: Major,
  files: Record<string, string>,
  options: {
    unlisted?: Record<string, string>;
    afterCall?: (call: string, root: string) => void;
  } = {},
) {
  const s = seed(LINT_POLICY, { revisions: 1, changes: Object.keys(files), alive: false });
  const tree = new FakeWorktree(s.repo.mainId, s.repo.commonDir);
  const writeDisk = (path: string, text: string) => {
    mkdirSync(dirname(join(tree.root, path)), { recursive: true });
    writeFileSync(join(tree.root, path), text);
    mkdirSync(dirname(join(s.repo.main, path)), { recursive: true });
    writeFileSync(join(s.repo.main, path), text);
  };
  const write = (path: string, text: string) => {
    tree.write(path, text);
    writeDisk(path, text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  for (const [path, text] of Object.entries(options.unlisted ?? {})) writeDisk(path, text);
  // No fixture's packages: ESLint and its toolchain only.
  install(tree.root, "none", major);
  tree.revise();
  const made = provider(tree.root);
  const seen: {
    snapshot: LintSnapshot | null;
    report: LintRunReport | null;
    inputs: ReadonlyMap<string, LintFileInputs>;
    files: readonly LintFile[];
  } = { snapshot: null, report: null, inputs: new Map(), files: [] };
  const run = lintPass(tree, {
    async open(format) {
      const answer = await made.open(format);
      options.afterCall?.("open", tree.root);
      return answer;
    },
    async refresh(level) {
      const answer = await made.refresh(level);
      if (!("off" in answer)) seen.snapshot = answer;
      options.afterCall?.("refresh", tree.root);
      return answer;
    },
    async inputs(paths) {
      const answer = await made.inputs(paths);
      seen.inputs = answer;
      options.afterCall?.("inputs", tree.root);
      return answer;
    },
    async lint(files) {
      const answer = await made.lint(files);
      if (!("off" in answer)) {
        seen.report = answer;
        seen.files = files;
      }
      options.afterCall?.("lint", tree.root);
      return answer;
    },
    close: () => made.close(),
  });
  passes.push(run.pass);
  const settle = async () => {
    run.pass.nudge();
    await run.pass.idle();
    expect(run.errors).toEqual([]);
  };
  await settle();
  const rig = {
    ...s,
    tree,
    settle,
    writeDisk,
    state() {
      return storeOf(tree).states.list(tree.id, { paths: ["src/a.js"] })[0] ?? expect.unreachable();
    },
    key() {
      return rig.state().judged?.key ?? expect.unreachable();
    },
    /** Rebuild the stored key from actual worker reads and the text the pass supplied. */
    readKey() {
      expect(["pass", "fail"]).toContain(rig.state().outcome);
      expect(rig.state().stale).toBe(false);
      const snapshot = seen.snapshot ?? expect.unreachable();
      const report = seen.report ?? expect.unreachable();
      const blobs = new Map(seen.files.map((f) => [f.path, blobHash(Buffer.from(f.text), "sha1")]));
      expect(report.held?.size).toBeGreaterThan(0);
      for (const [path, uses] of report.held ?? []) {
        if (underModules(path)) continue;
        expect(uses.unobserved, path).toBeUndefined();
        const bytes = [uses.typescript, ...uses.others].filter((b) => b !== undefined);
        expect(bytes.length, path).toBeGreaterThan(0);
        const used = bytes[0] ?? expect.unreachable();
        for (const blob of bytes) expect(blob, path).toBe(used);
        expect(path === "src/a.js" || report.closure.includes(path), path).toBe(true);
        blobs.set(path, used);
      }
      for (const path of report.closure) expect(blobs.has(path), path).toBe(true);
      const inputs = seen.inputs.get("src/a.js") ?? expect.unreachable();
      expect(inputs.wholeProgram).toBe(false);
      const key = lintKey(
        "src/a.js",
        inputs,
        {
          snapshot: { ...snapshot, ...report },
          installed: "none",
          nodeMajor: Number(process.versions.node.split(".")[0]),
        },
        (path) => blobs.get(path) ?? null,
        "",
      );
      expect(key).toBe(rig.key());
      return { key, blobs };
    },
    async changedJson() {
      const answer = await runLint(s.repo.main, ["--changed", "--json"], {
        CLAUDE_CODE_SESSION_ID: "s1",
      });
      expect(answer.code).toBe(0);
      return JSON.parse(answer.out);
    },
    async edit(changed: Record<string, string>) {
      for (const [path, text] of Object.entries(changed)) write(path, text);
      tree.revise();
      revise(s.store, s.repo, Object.keys(changed));
      await settle();
    },
    /** `src/a.js`'s stored findings, which a fresh ESLint run must give too, as `rule message`. */
    findings() {
      const result = storeOf(tree).results.get(lintCheck("src/a.js"), rig.key());
      const stored = (result ?? expect.unreachable()).findings;
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
