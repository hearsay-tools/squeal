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
  type LintSnapshot,
} from "../../../src/core/lint/pass/index.js";
import { lintStorePath } from "../../../src/core/lint/store/index.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { Policy } from "../../../src/core/types/index.js";
import type { LintFinding, LintTransitionKind } from "../../../src/core/types/lint.js";
import { FakeWorktree } from "../../code/pass/helpers.js";
import { commonDir, LINT_ON, open } from "../helpers.js";

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
  /** The program a lint report gives, when it grows past the refresh's; `null` for `program`. */
  linted: string[] | null = null;
  env: Record<string, string> = { ESLINT_USE_FLAT_CONFIG: "true" };
  /** The paths of each `lint` call, in order. */
  readonly calls: string[][] = [];
  /** Each refresh asked for, in order. */
  readonly refreshes: LintRefresh[] = [];
  /** The install fingerprint the pass reads (011 C11). */
  installed = "install-1";
  opened = 0;
  closed = 0;
  /** When set, `lint` waits for it before it answers. */
  gate: Promise<void> | null = null;
  /** D9: `inputs` rejects with this reason, as a config that does not load. */
  failInputs: string | null = null;
  /** D9: `lint` throws with this reason. */
  failLint: string | null = null;
  /** D9: `lint` resolves `LintOff` with this reason, as the third worker failure. */
  offOnLint: string | null = null;
  /** D9: the files `lint` gives `{ unknown }` for, with the reason. */
  readonly unknown = new Map<string, string>();
  /** The closure a lint report gives, when it grows past the refresh's; `null` for `closure`. */
  lintedClosure: string[] | null = null;

  open() {
    this.opened++;
    return Promise.resolve(this.declaration);
  }

  refresh(level: LintRefresh): Promise<LintSnapshot | { readonly off: string }> {
    this.refreshes.push(level);
    if ("off" in this.declaration) return Promise.resolve(this.declaration);
    return Promise.resolve({ declaration: this.declaration, ...this.environment() });
  }

  inputs(paths: readonly string[]) {
    if (this.failInputs !== null) return Promise.reject(new Error(this.failInputs));
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
  ): Promise<LintRunReport | { readonly off: string }> {
    this.calls.push(files.map((f) => f.path));
    if (this.gate !== null) await this.gate;
    if (this.failLint !== null) throw new Error(this.failLint);
    if (this.offOnLint !== null) return { off: this.offOnLint };
    const result = (f: { readonly path: string; readonly text: string }) => {
      const unknown = this.unknown.get(f.path);
      return unknown === undefined ? { findings: this.findings(f.text) } : { unknown };
    };
    return {
      results: new Map(
        files.filter((f) => extname(f.path) === ".js").map((f) => [f.path, result(f)]),
      ),
      ...this.environment(),
      closure: this.lintedClosure ?? this.closure,
      program: this.linted ?? this.program,
    };
  }

  private environment() {
    return { closure: this.closure, packages: this.packages, program: this.program, env: this.env };
  }

  close() {
    this.closed++;
    return Promise.resolve();
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
    format: "sha1",
    source: tree.source,
    policy: () => LINT_ON,
    provider: () => provider,
    installed: () => Promise.resolve(provider.installed),
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
