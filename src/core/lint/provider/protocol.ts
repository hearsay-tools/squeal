import type { RelativePath } from "../../types/common.js";
import type { EslintMessage } from "../eslint.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintFile,
  LintFileInputs,
  LintHeld,
} from "../pass/provider.js";

/*
 * Spec 017 D3: the messages between the daemon's thread and the ESLint
 * worker. Calls go one at a time; each answer names its call's `id`.
 */

/** The provider's own version, in every key (D5). Raise it when what the worker reports changes meaning. */
export const PROVIDER_VERSION = 4;

/** Stands for the project root in a computed config's JSON, so worktrees share keys (goal 7). */
export const ROOT_TOKEN = "<root>";

export type ToWorker =
  | { readonly type: "open"; readonly id: number }
  /** `fresh`: a new `ESLint` instance first (D4 `instance`). */
  | { readonly type: "refresh"; readonly id: number; readonly fresh: boolean }
  | { readonly type: "inputs"; readonly id: number; readonly paths: readonly RelativePath[] }
  | { readonly type: "lint"; readonly id: number; readonly files: readonly LintFile[] };

/** What the worker tells of one file: ESLint's messages, or why it has none. */
export type WorkerFileResult =
  | { readonly messages: readonly EslintMessage[] }
  | { readonly unknown: string };

/**
 * What changed since the thread's last answer (wave 1.7 W3): what it holds
 * of each path it used since, and the walk's reads and lookups, `null` for
 * one gone. The host keeps the whole of each for the thread's life.
 */
export interface WorkerDelta {
  readonly held: readonly (readonly [RelativePath, LintHeld])[];
  readonly walked: readonly (readonly [RelativePath, string | null])[];
  readonly lookups: readonly (readonly [RelativePath, string | null])[];
}

export type WorkerAnswer =
  | { readonly type: "open"; readonly declaration: LintDeclaration }
  | { readonly type: "off"; readonly reason: string }
  | {
      readonly type: "snapshot";
      readonly declaration: LintDeclaration;
      readonly env: LintEnvironment;
      readonly delta: WorkerDelta;
      /** A name the program kept resolves to another file (Q1), or a tsconfig's root files changed: the thread must be new. */
      readonly moved?: true;
    }
  | {
      readonly type: "inputs";
      readonly inputs: readonly (readonly [RelativePath, LintFileInputs])[];
    }
  | {
      readonly type: "linted";
      readonly results: readonly (readonly [RelativePath, WorkerFileResult])[];
      readonly env: LintEnvironment;
      readonly delta: WorkerDelta;
    };

export type FromWorker =
  /** A unit of work done: the guard starts again (D3, 5 s per file). */
  | { readonly type: "progress"; readonly id: number }
  | { readonly type: "done"; readonly id: number; readonly answer: WorkerAnswer }
  /** The call failed and the worker lives on, as when the config does not load (D9). */
  | { readonly type: "error"; readonly id: number; readonly message: string };

/** What a caller sends; the thread numbers it. */
export type WorkerCall = ToWorker extends infer M
  ? M extends { id: number }
    ? Omit<M, "id">
    : never
  : never;

/** An error's first line, for a reason. */
export function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0]?.trim() ?? "";
}
