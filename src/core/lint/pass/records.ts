import type {
  EpochMs,
  FileHash,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { LintTool } from "../../types/lint.js";
import type { LintMetaRepo } from "../store/types.js";
import type { KeyInputs } from "./keys.js";

/*
 * The lint pass's own facts per worktree, in the lint store's `meta` table
 * (017-03's notes: the schema stays v1), each under a `lint-` prefix. Each is JSON; one that does not
 * parse reads as absent, so the next pass keys again.
 *
 * Each tool's pass keeps its own (D11), under its scope (`lintScope`): the
 * worktree's id for ESLint, so ESLint's records are the release before's,
 * and `<id>:<tool>` for another tool. The keying record alone is the
 * worktree's, written by every tool's pass: a delivery's summary and the
 * D8 cut follow the last keying of any tool.
 */

/** The id a tool's pass keys its records under; ESLint's is the worktree's own. */
export const lintScope = (worktreeId: WorktreeId, tool: LintTool): string =>
  tool === "eslint" ? worktreeId : `${worktreeId}:${tool}`;

/** D7 step 2: the revision the pass last keyed at, and the environment it keyed with. */
export interface LintCursor {
  readonly revision: RevisionNumber;
  readonly environment: string;
}

/** D5: the program segment whole-program files were keyed at, and those files. */
export interface LintProgram {
  readonly segment: string;
  readonly files: readonly RelativePath[];
  /** The extensions ESLint lints beside the module ones: the segment holds their files' blobs. */
  readonly extensions: readonly string[];
}

/**
 * Row 019-21 (review 0.1.396 B2): the inputs the cursor's keys were made
 * of, written with the cursor, so a commit's report can tell a result made
 * under its own config from one made under a config left unstaged.
 * `environment` is the cursor's: a record beside another cursor (an older
 * daemon's keying) is no evidence.
 */
export interface LintInputs extends KeyInputs {
  readonly environment: string;
}

/**
 * D8: the last keying of every file, `first` or `config`, numbered. Its
 * files lint with no transition, so this is the only trace a delivery's
 * summary line can follow: a config keying whose keys all hit, or a nested
 * config's, moves no other record.
 */
export interface LintKeying {
  /** 1 for the worktree's first keying, one more at each after it. */
  readonly seq: number;
  readonly mode: "first" | "config";
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
  /**
   * The worktree's newest transition id when it ran: a transition after it
   * was judged under the keying's config, one before it may not be (D8
   * Blocking).
   */
  readonly transition: number;
}

export const cursorKey = (worktreeId: WorktreeId) => `lint-cursor:${worktreeId}`;
export const keyingKey = (worktreeId: WorktreeId) => `lint-keying:${worktreeId}`;
/** Paths a first or config keying left pending: linted with no transition (D2's last row). */
export const quietKey = (worktreeId: WorktreeId) => `lint-quiet:${worktreeId}`;
export const programKey = (worktreeId: WorktreeId) => `lint-program:${worktreeId}`;
export const inputsKey = (worktreeId: WorktreeId) => `lint-inputs:${worktreeId}`;
/** Spec 019 D5 step 1 (row 019-22): paths a commit or request released for a tool held for a commit. */
export const releaseKey = (worktreeId: WorktreeId) => `lint-release:${worktreeId}`;
/** D9: why the provider is off, for status (wave 2); absent while it is on. */
export const offKey = (worktreeId: WorktreeId) => `lint-off:${worktreeId}`;
/** D9: why the last keying failed, as a config that does not load; absent once one keys. */
export const failedKey = (worktreeId: WorktreeId) => `lint-failed:${worktreeId}`;
/** D9: how many keyings failed, one more at each, so each failed pass is told once (wave 2). */
export const failuresKey = (worktreeId: WorktreeId) => `lint-failures:${worktreeId}`;
/** D9: how many times lint went off, one more at each, so each is told once (wave 2). */
export const offsKey = (worktreeId: WorktreeId) => `lint-offs:${worktreeId}`;

function parse(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readCursor(meta: LintMetaRepo, worktreeId: WorktreeId): LintCursor | null {
  const raw = parse(meta.get(cursorKey(worktreeId))) as Partial<LintCursor> | null;
  if (typeof raw?.revision !== "number" || typeof raw.environment !== "string") return null;
  return { revision: raw.revision, environment: raw.environment };
}

export function writeCursor(meta: LintMetaRepo, worktreeId: WorktreeId, cursor: LintCursor) {
  meta.set(cursorKey(worktreeId), JSON.stringify(cursor));
}

export function readInputs(meta: LintMetaRepo, worktreeId: WorktreeId): LintInputs | null {
  const raw = parse(meta.get(inputsKey(worktreeId))) as Partial<LintInputs> | null;
  const { environment, files, installed } = raw ?? {};
  if (typeof environment !== "string" || typeof installed !== "boolean") return null;
  if (!Array.isArray(files)) return null;
  const pairs: [RelativePath, FileHash | null][] = [];
  for (const entry of files as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [path, blob] = entry as unknown[];
    if (typeof path !== "string" || (blob !== null && typeof blob !== "string")) return null;
    pairs.push([path, blob]);
  }
  return { environment, files: pairs, installed };
}

/** Writes the record when it changed: an edit's keying keeps it as it was. */
export function writeInputs(meta: LintMetaRepo, worktreeId: WorktreeId, inputs: LintInputs) {
  const { environment, files, installed } = inputs;
  writeReason(meta, inputsKey(worktreeId), JSON.stringify({ environment, files, installed }));
}

export function readKeying(meta: LintMetaRepo, worktreeId: WorktreeId): LintKeying | null {
  const raw = parse(meta.get(keyingKey(worktreeId))) as Partial<LintKeying> | null;
  const { seq, mode, revision, at, transition } = raw ?? {};
  const numbers = [seq, revision, at, transition];
  if (!numbers.every((n) => typeof n === "number")) return null;
  if (mode !== "first" && mode !== "config") return null;
  return { seq, mode, revision, at, transition } as LintKeying;
}

/** Records a first or config keying, numbered one after the last. */
export function writeKeying(
  meta: LintMetaRepo,
  worktreeId: WorktreeId,
  keying: Omit<LintKeying, "seq">,
): void {
  const seq = (readKeying(meta, worktreeId)?.seq ?? 0) + 1;
  meta.set(keyingKey(worktreeId), JSON.stringify({ seq, ...keying }));
}

export function readQuiet(meta: LintMetaRepo, worktreeId: WorktreeId): Set<RelativePath> {
  const raw = parse(meta.get(quietKey(worktreeId)));
  return new Set(Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : []);
}

export function writeQuiet(
  meta: LintMetaRepo,
  worktreeId: WorktreeId,
  quiet: ReadonlySet<RelativePath>,
) {
  if (quiet.size === 0) meta.delete(quietKey(worktreeId));
  else meta.set(quietKey(worktreeId), JSON.stringify([...quiet].sort()));
}

export function readProgram(meta: LintMetaRepo, worktreeId: WorktreeId): LintProgram {
  const raw = parse(meta.get(programKey(worktreeId))) as Partial<LintProgram> | null;
  if (typeof raw?.segment !== "string" || !Array.isArray(raw.files)) {
    return { segment: "", files: [], extensions: [] };
  }
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  return { segment: raw.segment, files: strings(raw.files), extensions: strings(raw.extensions) };
}

export function writeProgram(meta: LintMetaRepo, worktreeId: WorktreeId, program: LintProgram) {
  meta.set(
    programKey(worktreeId),
    JSON.stringify({
      ...program,
      files: [...program.files].sort(),
      extensions: [...program.extensions].sort(),
    }),
  );
}

/** The number under `key`; 0 when none is written or it does not parse. */
export function readCount(meta: LintMetaRepo, key: string): number {
  const value = parse(meta.get(key));
  return typeof value === "number" ? value : 0;
}

/** One more under `key`. */
export function countOne(meta: LintMetaRepo, key: string): void {
  meta.set(key, JSON.stringify(readCount(meta, key) + 1));
}

/**
 * D11: a tool left `lint.tools`: its pass's records go, so its next pass is
 * a first keying. The counts stay: a consumer's mark compares with them.
 */
export function forgetRecords(meta: LintMetaRepo, scope: string): void {
  for (const key of [cursorKey, quietKey, programKey, inputsKey, offKey, failedKey, releaseKey]) {
    meta.delete(key(scope));
  }
}

/** D11: an off reason that says the tool is not installed (D3 step 1, D11 Discovery). */
export const isNotInstalled = (reason: string) => /^no (ESLint|oxlint) installed in /.test(reason);

/**
 * D9: why lint is off, or `null` once it is on; a new off reason counts one
 * more under `offsKey`, so a delivery tells it once. D11: another tool's
 * "not installed" is no notice: the surfaces leave it out while a tool
 * lints, and ESLint's reason is told when none does.
 */
export function writeOff(
  meta: LintMetaRepo,
  worktreeId: WorktreeId,
  reason: string | null,
  tool: LintTool = "eslint",
) {
  const key = offKey(worktreeId);
  const notice = tool === "eslint" || reason === null || !isNotInstalled(reason);
  if (reason !== null && meta.get(key) !== reason && notice) countOne(meta, offsKey(worktreeId));
  writeReason(meta, key, reason);
}

/** Writes a reason under `key`, or deletes it with `null`. */
export function writeReason(meta: LintMetaRepo, key: string, reason: string | null) {
  if (reason === null) meta.delete(key);
  else if (meta.get(key) !== reason) meta.set(key, reason);
}
