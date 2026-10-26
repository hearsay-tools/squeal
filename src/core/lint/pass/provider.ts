import type { ObjectFormat } from "../../hash/index.js";
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
/** The bytes the worker holds of one path, as git blob hashes in the format `open` gave (wave 1.7). */
export interface LintHeld {
  readonly typescript?: string; // TypeScript's copy: the bytes its service read, or the text it was given
  readonly others: readonly string[]; // every other use: modules loaded, files the config, rules or plugins read
  readonly unobserved?: true; // read in a way the worker cannot hash: it matches no blob
}
export interface LintEnvironment {
  readonly closure: readonly RelativePath[]; // project files the config loaded, tsconfig files included (D4)
  readonly packages: readonly string[]; // package roots the config loaded
  readonly program: readonly RelativePath[]; // the tsconfig program's files, [] when none
  readonly env: Readonly<Record<string, string>>; // the keyed variables (D5)
  readonly held?: ReadonlyMap<RelativePath, LintHeld>; // each path outside node_modules the worker used, `../` above the root
  readonly walked?: ReadonlyMap<RelativePath, string>; // the blobs the program walk read each file's imports from
  readonly lookups?: ReadonlyMap<RelativePath, string>; // the paths whose state decides the walk's lookups, at that state
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
  readonly blob?: string; // the text's blob: what TypeScript holds of the path once given it
}
export interface LintProvider {
  open(format?: ObjectFormat): Promise<LintDeclaration | LintOff>; // the worktree's object format, for `held` and `walked`
  refresh(level: LintRefresh): Promise<LintSnapshot | LintOff>; // applies the D4 level, then reports; "none" only reports
  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>>; // only files ESLint lints, as of the last refresh
  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff>;
  close(): Promise<void>;
}
