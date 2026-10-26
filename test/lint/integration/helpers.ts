import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { createLintPass, type LintPassReport } from "../../../src/core/lint/pass/index.js";
import type { FakeWorktree } from "../../code/pass/helpers.js";
import { LINT_ON, open } from "../helpers.js";
import { FIXTURES, install, provider, sources } from "../provider/helpers.js";

/*
 * The real provider and pass over fixture worktrees on one lint store, as
 * the daemon runs them (reviews 0.1.348 and 0.1.348-r2).
 */

/**
 * The fixture `name` in `tree`, its tools installed and one revision made.
 * `edit` changes a file's text; `unlisted` names files written on disk
 * outside the listing, as generated or git-ignored files are.
 */
export function fixture(
  tree: FakeWorktree,
  name: string,
  edit: (path: string, text: string) => string = (_, text) => text,
  unlisted: readonly string[] = [],
): void {
  for (const path of sources(name)) {
    const text = edit(path, readFileSync(join(FIXTURES, name, path), "utf8"));
    if (unlisted.includes(path)) writeFileSync(join(tree.root, path), text);
    else tree.write(path, text);
  }
  install(tree.root, name);
  tree.revise();
}

/** The typed project's edit: the tsconfig narrowed to `t.ts`, `u.ts` ESLint-ignored. */
export function narrowed(path: string, text: string): string {
  if (path === "tsconfig.json") return text.replace('"src/**/*.ts"', '"src/t.ts"');
  if (path === "eslint.config.js")
    return text.replace('"eslint.config.js"]', '"eslint.config.js", "src/u.ts"]');
  return text;
}

/** The daemon's lint pass over `tree` with the real provider, kept open between passes. */
export function daemon(tree: FakeWorktree) {
  const reports: LintPassReport[] = [];
  const errors: Error[] = [];
  const pass = createLintPass({
    worktreeId: tree.id,
    root: tree.root,
    commonDir: tree.commonDir,
    format: "sha1",
    source: tree.source,
    policy: () => LINT_ON,
    provider: () => provider(tree.root),
    installed: () => Promise.resolve("install-1"),
    log: () => {},
    onError: (error) => errors.push(error),
    onPass: (report) => reports.push(report),
  });
  return {
    reports,
    /** A pass, then `path`'s state and the rules and messages of its result. */
    async run(path = "src/t.ts") {
      pass.nudge();
      await pass.idle();
      expect(errors).toEqual([]);
      const store = open(tree.commonDir);
      const state = store.states.list(tree.id, { paths: [path] })[0];
      const check = { kind: "lint", path, tool: "eslint" } as const;
      const result = state?.judged ? store.results.get(check, state.judged.key) : null;
      return {
        state,
        rules: result?.findings.map((f) => f.rule),
        messages: result?.findings.map((f) => f.message),
      };
    },
    close: () => pass.close(),
  };
}

/** One pass of a new daemon over `tree`. */
export async function passOver(tree: FakeWorktree, path?: string) {
  const one = daemon(tree);
  const after = await one.run(path);
  await one.close();
  return { ...after, reports: one.reports };
}
