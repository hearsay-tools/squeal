import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash, type ObjectFormat } from "../../../src/core/hash/blob.js";
import { lineHash } from "../../../src/core/lint/fingerprint.js";
import { lintCheck } from "../../../src/core/lint/pass/judge.js";
import { lintKey } from "../../../src/core/lint/pass/keys.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintFile,
  LintFileResult,
  LintHeld,
  LintRefresh,
  LintRunReport,
  LintSnapshot,
} from "../../../src/core/lint/pass/provider.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import type { EpochMs } from "../../../src/core/types/common.js";
import type { CheckKey } from "../../../src/core/types/keys.js";
import { FakeProvider } from "./helpers.js";

/** The Node major the pass keys at: given, so no test reads the running version (spec 010 D4). */
export const NODE_MAJOR = 24;

/** One clock for the pass and the provider: a stored result's `lintedAt` follows its lint call's. */
export class Clock {
  at = 1_000;
  readonly now = (): EpochMs => (this.at += 10);
}

/** One lint call: its paths, when it ran, and the inputs its thread had read by its end. */
interface Read {
  readonly paths: readonly string[];
  readonly at: EpochMs;
  readonly held: readonly string[];
}

/**
 * Row 017-29: a provider whose rules read an input lazily, as a rule that
 * loads a baseline the first time it needs it. A file whose text holds a
 * marker of `lazy` reads the marker's input once per thread and keeps its
 * bytes: every later file with the marker uses them without a read. A file
 * with the marker fails the marker's rule while the input says `strict`.
 * The thread holds what it read (`held`) until a new thread: `open`, a
 * `thread` refresh, or a call `threadAt` names, as the ESLint provider
 * starts one after a failed thread (D9).
 */
export class LazyRules extends FakeProvider {
  /** Each lint call, in order. */
  readonly ran: Read[] = [];
  /** The indexes of the lint calls that start on a new thread. */
  readonly threadAt = new Set<number>();
  readonly #bytes = new Map<string, string>();

  constructor(
    root: string,
    readonly lazy: ReadonlyMap<string, string>,
    private readonly clock: Clock,
  ) {
    super();
    this.root = root;
  }

  override open(format?: ObjectFormat) {
    this.#bytes.clear();
    return super.open(format);
  }

  override async refresh(level: LintRefresh): Promise<LintSnapshot | { readonly off: string }> {
    if (level === "thread") this.#bytes.clear();
    const snapshot = await super.refresh(level);
    return "off" in snapshot ? snapshot : this.#held(snapshot);
  }

  override async lint(
    files: readonly LintFile[],
  ): Promise<LintRunReport | { readonly off: string }> {
    if (this.threadAt.has(this.calls.length)) this.#bytes.clear();
    const failed = new Map(files.map((f) => [f.path, this.#use(f.text)]));
    const report = await super.lint(files);
    if ("off" in report) return report;
    const held = [...this.#bytes.keys()].sort();
    this.ran.push({ paths: files.map((f) => f.path), at: this.clock.at, held });
    const results = new Map<string, LintFileResult>();
    for (const [path, result] of report.results) {
      const more = (failed.get(path) ?? []).map(finding);
      results.set(path, "unknown" in result ? result : { findings: [...result.findings, ...more] });
    }
    return { ...this.#held(report), results };
  }

  /** D5's key of `path` with the closure and `inputs`, at the bytes on disk now. */
  keyOf(path: string, inputs: readonly string[]): CheckKey {
    const snapshot = {
      declaration: this.declaration as LintDeclaration,
      closure: [...this.closure, ...inputs],
      packages: this.packages,
      program: this.program,
      env: this.env,
    };
    const basis = { snapshot, installed: "none", nodeMajor: NODE_MAJOR };
    const config = {
      config: JSON.stringify({ rules: { off: [...this.off].sort() } }),
      wholeProgram: false,
    };
    return lintKey(path, config, basis, (p) => this.#blob(p), "");
  }

  /** The rules `text` fails: each marker's input read now, or kept from the thread's earlier read. */
  #use(text: string): string[] {
    const failed: string[] = [];
    for (const [marker, input] of this.lazy) {
      if (!text.includes(marker)) continue;
      if (!this.#bytes.has(input)) {
        this.#bytes.set(input, readFileSync(join(this.root as string, input), "utf8"));
      }
      if (this.#bytes.get(input)?.includes("strict") === true) failed.push(marker);
    }
    return failed;
  }

  /** `env` with each input the thread read held at the bytes it read. */
  #held<T extends LintEnvironment>(env: T): T {
    const held = new Map<string, LintHeld>(env.held ?? []);
    for (const [path, text] of this.#bytes) {
      held.set(path, { others: [blobHash(Buffer.from(text), "sha1")] });
    }
    return { ...env, held };
  }

  #blob(path: string): string | null {
    try {
      return blobHash(readFileSync(join(this.root as string, path)), "sha1");
    } catch {
      return null;
    }
  }
}

function finding(marker: string) {
  const rule = marker.replace(" ", "-");
  return {
    rule,
    message: `${rule} found`,
    severity: "error" as const,
    line: 1,
    column: 1,
    lineHash: lineHash(marker),
  };
}

/**
 * Each result stored for `paths` at a key whose closure holds a subset of
 * the lazy inputs, with the lint call that made it (the last one before its
 * `lintedAt`): `missing` names one whose key lacks an input its own thread
 * had read by then. The bytes on disk must be those the results were made at.
 */
export function unheld(
  store: LintStore,
  provider: LazyRules,
  paths: readonly string[],
): { checked: number; missing: string[] } {
  const inputs = [...new Set(provider.lazy.values())].sort();
  const subsets: string[][] = [[]];
  for (const input of inputs) for (const subset of [...subsets]) subsets.push([...subset, input]);
  const missing: string[] = [];
  let checked = 0;
  for (const path of paths) {
    for (const subset of subsets) {
      const result = store.results.get(lintCheck(path, "eslint"), provider.keyOf(path, subset));
      if (result === null) continue;
      checked++;
      const call = provider.ran
        .filter((r) => r.paths.includes(path) && r.at < result.lintedAt)
        .at(-1);
      const lacks =
        call === undefined ? ["its call"] : call.held.filter((p) => !subset.includes(p));
      if (lacks.length > 0)
        missing.push(`${path} at [${subset.join(", ")}] lacks ${lacks.join(", ")}`);
    }
  }
  return { checked, missing };
}
