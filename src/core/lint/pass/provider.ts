import type { RelativePath } from "../../types/index.js";
import type { LintFinding } from "../../types/lint.js";

/*
 * Spec 017 D3 to D5: what the lint pass asks of a provider. The pass owns
 * this file (row 017-05); the ESLint provider (row 017-04) matches it
 * structurally and runs in its own worker thread.
 */

/** Spec 017 D4: how the worker is refreshed before it lints. */
export type LintRefresh = "none" | "instance" | "thread";

/** Spec 017 D3: the provider declared once, as data. */
export interface LintDeclaration {
  readonly tool: "eslint";
  readonly toolVersion: string;
  readonly providerVersion: number;
  readonly configFiles: readonly RelativePath[];
}

/** Spec 017 D5: what decides one file's findings beside its bytes. */
export interface LintFileInputs {
  /** `calculateConfigForFile`, as JSON. */
  readonly config: string;
  /** Typed signals, or a known cross-file plugin's rules (D5). */
  readonly wholeProgram: boolean;
}

/** One `lint` call's results and what the config loaded for it. */
export interface LintRunReport {
  readonly results: ReadonlyMap<
    RelativePath,
    { readonly findings: readonly LintFinding[] } | { readonly unknown: string }
  >;
  /** Project files the config loaded (D4). */
  readonly closure: readonly RelativePath[];
  /** Package roots the config loaded. */
  readonly packages: readonly string[];
  /** The tsconfig program's files, `[]` when none. */
  readonly program: readonly RelativePath[];
  /** The keyed variables (D5). */
  readonly env: Readonly<Record<string, string>>;
}

export interface LintProvider {
  open(): Promise<LintDeclaration | { readonly off: string }>;
  /** Only files ESLint lints. */
  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>>;
  lint(
    files: readonly { readonly path: RelativePath; readonly text: string }[],
    refresh: LintRefresh,
  ): Promise<LintRunReport>;
  close(): Promise<void>;
}
