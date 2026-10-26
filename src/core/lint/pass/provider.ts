import type { RelativePath } from "../../types/index.js";
import type { LintFinding } from "../../types/lint.js";

/*
 * Spec 017 D3 to D5: what the lint pass asks of a provider. The pass owns
 * this file (row 017-05); the ESLint provider (row 017-04,
 * `src/core/lint/provider/`) implements it in its own worker thread. The pass calls
 * `refresh("none")` once after `open()`, and `refresh(level)` before
 * `inputs()` in any pass that refreshes; on `LintOff` it closes the
 * provider and records the reason.
 */

export type LintRefresh = "none" | "instance" | "thread"; // spec 017 D4
export interface LintOff {
  readonly off: string;
} // open refused, or the provider turned itself off (D9: 3 restarts in 10 minutes)
export interface LintDeclaration {
  readonly tool: "eslint";
  readonly toolVersion: string;
  readonly providerVersion: number;
  readonly configFiles: readonly RelativePath[];
}
export interface LintFileInputs {
  readonly config: string; // calculateConfigForFile, as JSON
  readonly wholeProgram: boolean; // typed signals, or a known cross-file plugin's rules (D5)
}
export interface LintEnvironment {
  readonly closure: readonly RelativePath[]; // project files the config loaded, tsconfig files included (D4)
  readonly packages: readonly string[]; // package roots the config loaded
  readonly program: readonly RelativePath[]; // the tsconfig program's files, [] when none
  readonly env: Readonly<Record<string, string>>; // the keyed variables (D5)
}
export interface LintSnapshot extends LintEnvironment {
  readonly declaration: LintDeclaration; // may change after "thread" (a new ESLint install)
}
export type LintFileResult =
  | { readonly findings: readonly LintFinding[] }
  | { readonly unknown: string };
export interface LintRunReport extends LintEnvironment {
  readonly results: ReadonlyMap<RelativePath, LintFileResult>;
}
export interface LintFile {
  readonly path: RelativePath;
  readonly text: string;
}
export interface LintProvider {
  open(): Promise<LintDeclaration | LintOff>;
  refresh(level: LintRefresh): Promise<LintSnapshot | LintOff>; // applies the D4 level, then reports; "none" only reports
  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>>; // only files ESLint lints, as of the last refresh
  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff>;
  close(): Promise<void>;
}
