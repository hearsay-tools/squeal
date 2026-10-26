import { extname } from "node:path";
import { lineHash } from "../../../src/core/lint/fingerprint.js";
import {
  createLintPass,
  type LintDeclaration,
  type LintFileInputs,
  type LintPassOptions,
  type LintPassReport,
  type LintProvider,
  type LintRefresh,
  type LintRunReport,
} from "../../../src/core/lint/pass/index.js";
import { lintStorePath } from "../../../src/core/lint/store/index.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { Policy } from "../../../src/core/types/index.js";
import type { LintFinding, LintTransitionKind } from "../../../src/core/types/lint.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir, LINT_ON, open } from "../helpers.js";

/** One `lint` call the fake provider took: the paths and the refresh. */
export interface LintCall {
  readonly paths: readonly string[];
  readonly refresh: LintRefresh;
}

/**
 * A fake provider (017-04 is a sibling row). It lints `.js` files: each line
 * `bad <rule>` is one finding of `<rule>`, unless `off` holds the rule.
 * `config` is its computed config, the same for every file unless
 * `configs` names one; `wholeProgram` lists the files with typed rules.
 */
export class FakeProvider implements LintProvider {
  declaration: LintDeclaration | { readonly off: string } = {
    tool: "eslint",
    toolVersion: "9.30.0",
    providerVersion: 1,
    configFiles: ["eslint.config.js"],
  };
  off = new Set<string>();
  readonly configs = new Map<string, string>();
  readonly wholeProgram = new Set<string>();
  closure: string[] = ["eslint.config.js"];
  packages: string[] = [];
  program: string[] = [];
  env: Record<string, string> = { ESLINT_USE_FLAT_CONFIG: "true" };
  /** Each `lint` call with files in it. */
  readonly calls: LintCall[] = [];
  /** Each refresh asked for, with or without files. */
  readonly refreshes: LintRefresh[] = [];
  opened = 0;
  closed = 0;
  /** When set, `lint` waits for it before it answers. */
  gate: Promise<void> | null = null;

  open() {
    this.opened++;
    return Promise.resolve(this.declaration);
  }

  inputs(paths: readonly string[]) {
    const config = JSON.stringify({ rules: { off: [...this.off].sort() } });
    return Promise.resolve(
      new Map<string, LintFileInputs>(
        paths
          .filter((p) => extname(p) === ".js" && !this.declarationFiles().includes(p))
          .map((p) => [
            p,
            { config: this.configs.get(p) ?? config, wholeProgram: this.wholeProgram.has(p) },
          ]),
      ),
    );
  }

  async lint(
    files: readonly { readonly path: string; readonly text: string }[],
    refresh: LintRefresh,
  ): Promise<LintRunReport> {
    this.refreshes.push(refresh);
    if (files.length > 0) this.calls.push({ paths: files.map((f) => f.path), refresh });
    if (this.gate !== null) await this.gate;
    return {
      results: new Map(files.map((f) => [f.path, { findings: this.findings(f.text) }])),
      closure: this.closure,
      packages: this.packages,
      program: this.program,
      env: this.env,
    };
  }

  close() {
    this.closed++;
    return Promise.resolve();
  }

  /** The paths of every `lint` call, in order. */
  linted(): string[][] {
    return this.calls.map((c) => [...c.paths]);
  }

  findings(text: string): LintFinding[] {
    return text.split("\n").flatMap((line, i) => {
      const rule = /^bad (\S+)/.exec(line)?.[1];
      if (rule === undefined || this.off.has(rule)) return [];
      return [
        {
          rule,
          message: `${rule} found`,
          severity: "error",
          line: i + 1,
          column: 1,
          lineHash: lineHash(line),
        },
      ];
    });
  }

  private declarationFiles(): readonly string[] {
    return "configFiles" in this.declaration ? this.declaration.configFiles : [];
  }
}

/** A worktree in `dir` with an ESLint config, written but not revised. */
export function lintTree(id = "w1", dir = commonDir()): FakeWorktree {
  return new FakeWorktree(id, dir).write("eslint.config.js", "export default [];\n");
}

/** The daemon's lint pass over `tree`, with what it reported, raised and logged. */
export function lintPass(
  tree: FakeWorktree,
  provider: FakeProvider,
  over: Partial<LintPassOptions> & { policy?: () => Policy } = {},
) {
  const reports: LintPassReport[] = [];
  const errors: Error[] = [];
  const logs: string[] = [];
  let at = 1_000;
  const pass = createLintPass({
    worktreeId: tree.id,
    root: tree.root,
    commonDir: tree.commonDir,
    source: tree.source,
    policy: () => LINT_ON,
    provider: () => provider,
    now: () => (at += 10),
    log: (text) => logs.push(text),
    onError: (error) => errors.push(error),
    onPass: (report) => reports.push(report),
    ...over,
  });
  return { pass, reports, errors, logs, storePath: lintStorePath(tree.commonDir) };
}

/** Each file's outcome in `tree`, with `+stale` when it is stale. */
export function outcomes(store: LintStore, tree: FakeWorktree): Record<string, string> {
  return Object.fromEntries(
    store.states
      .list(tree.id)
      .map((s) => [s.check.path, s.stale ? `${s.outcome}+stale` : s.outcome]),
  );
}

/** Each file's transitions in `tree`, oldest first, as `kind +added -removed`. */
export function history(store: LintStore, tree: FakeWorktree, path: string): string[] {
  return store.transitions
    .history(tree.id, { kind: "lint", path, tool: "eslint" })
    .map((t) => describe(t.kind, t.added, t.removed));
}

function describe(
  kind: LintTransitionKind,
  added: readonly LintFinding[],
  removed: readonly LintFinding[],
): string {
  const rules = (sign: string, list: readonly LintFinding[]) =>
    list.map((f) => ` ${sign}${f.rule ?? "fatal"}`).join("");
  return `${kind}${rules("+", added)}${rules("-", removed)}`;
}

/** The lint store of `tree`'s common dir, opened by the test, closed after it. */
export function storeOf(tree: FakeWorktree): LintStore {
  return open(tree.commonDir);
}
