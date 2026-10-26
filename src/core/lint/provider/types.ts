import type { RelativePath } from "../../types/common.js";
import type { LintFinding } from "../../types/lint.js";

/*
 * Spec 017's provider interface, as the wave 1 brief and its amendment
 * (2026-10-26, agreed with 017-05) give it. 017-05 owns the same types in
 * `src/core/lint/pass/provider.ts`; this copy matches them structurally and
 * goes at integration.
 */

/** Spec 017 D4: how the provider is refreshed before it lints. */
export type LintRefresh = "none" | "instance" | "thread";

/** Open refused, or the provider turned itself off (D9: 3 failures in 10 minutes). */
export interface LintOff {
  readonly off: string;
}

/** Spec 017 D3: the provider, declared once as data. */
export interface LintDeclaration {
  readonly tool: "eslint";
  readonly toolVersion: string;
  readonly providerVersion: number;
  readonly configFiles: readonly RelativePath[];
}

/** Spec 017 D5: what a file's key takes from ESLint. */
export interface LintFileInputs {
  /** `calculateConfigForFile`, as JSON, the project root written `<root>`. */
  readonly config: string;
  /** Typed signals, or a known cross-file plugin's rules (D5). */
  readonly wholeProgram: boolean;
}

/** Spec 017 D4, D5: what the current worker thread loaded and read, since it started. */
export interface LintEnvironment {
  /** Project files the config loaded, tsconfig files included (D4). */
  readonly closure: readonly RelativePath[];
  /** Package roots the config loaded. */
  readonly packages: readonly string[];
  /** The tsconfig program's files, `[]` when none. */
  readonly program: readonly RelativePath[];
  /** The keyed variables (D5). */
  readonly env: Readonly<Record<string, string>>;
}

export interface LintSnapshot extends LintEnvironment {
  /** May change after `thread`, as when a new ESLint is installed. */
  readonly declaration: LintDeclaration;
}

/** One file's findings, or why it has none. */
export type LintFileResult =
  | { readonly findings: readonly LintFinding[] }
  | { readonly unknown: string };

export interface LintRunReport extends LintEnvironment {
  readonly results: ReadonlyMap<RelativePath, LintFileResult>;
}

/** One file to lint, with the bytes it is linted at. */
export interface LintFile {
  readonly path: RelativePath;
  readonly text: string;
}

export interface LintProvider {
  open(): Promise<LintDeclaration | LintOff>;
  /** Applies the D4 level, then reports; `none` only reports. */
  refresh(level: LintRefresh): Promise<LintSnapshot | LintOff>;
  /** Only files ESLint lints, as of the last refresh. */
  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>>;
  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff>;
  close(): Promise<void>;
}
