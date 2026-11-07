import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { createLintPass } from "../../../src/core/lint/pass/index.js";
import { oxlintProvider } from "../../../src/core/lint/provider/oxlint/provider.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { commonDir, LINT_ON, open } from "../helpers.js";
import { DiskWorktree } from "./disk.js";
import { project } from "./helpers.js";

/*
 * Spec 017 D11 through the daemon's lint pass with the real oxlint: the
 * key holds each config's bytes when no program segment does (no import
 * plugin), so a config edit lints every file again.
 */

const WORKTREE = "w1";
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

/** The real oxlint pass over `files`, its first pass run. */
async function oxlintRig(files: Record<string, string>) {
  const root = project(files) as AbsolutePath;
  const disk = new DiskWorktree(root);
  const dir = commonDir();
  const pass = createLintPass({
    worktreeId: WORKTREE,
    tool: "oxlint",
    root,
    commonDir: dir,
    format: "sha1",
    source: disk.source,
    policy: () => LINT_ON,
    provider: () => oxlintProvider({ root, env: { PATH: process.env.PATH } }),
    installed: () => Promise.resolve("install-1"),
    idleIn: () => 0,
    log: () => {},
    onError: (error) => {
      throw error;
    },
  });
  onTestFinished(() => pass.close());
  const store = open(dir);
  const revise = async () => {
    disk.revise();
    for (let round = 0; round < 40; round++) {
      pass.nudge();
      await pass.idle();
      const busy = store.states.list(WORKTREE).some((s) => s.outcome === "pending" || s.stale);
      if (!busy) return;
      await sleep(100);
    }
  };
  await revise();
  return { root, store, revise };
}

/** Each file's oxlint findings as `rule severity`. */
function findings(store: LintStore): Record<string, string[]> {
  return Object.fromEntries(
    store.states.list(WORKTREE, { tool: "oxlint" }).map((s) => {
      const result = s.judged === null ? null : store.results.get(s.check, s.judged.key);
      return [s.check.path, result?.findings.map((f) => `${f.rule} ${f.severity}`) ?? [s.outcome]];
    }),
  );
}

describe("oxlint through the daemon's lint pass (017 D11)", () => {
  it("lints every file again when a config's rule changes, with no import plugin", {
    timeout: 60_000,
  }, async () => {
    const config = (severity: string) =>
      json({ plugins: ["eslint"], rules: { "no-unused-vars": severity } });
    const rig = await oxlintRig({
      ".oxlintrc.json": config("error"),
      "src/a.js": "const unused = 1;\n",
      "src/b.js": "export const used = 1;\n",
    });
    expect(findings(rig.store)).toEqual({
      "src/a.js": ["eslint(no-unused-vars) error"],
      "src/b.js": [],
    });
    writeFileSync(join(rig.root, ".oxlintrc.json"), config("warn"));
    await rig.revise();
    expect(findings(rig.store)).toEqual({
      "src/a.js": ["eslint(no-unused-vars) warning"],
      "src/b.js": [],
    });
  });
});
