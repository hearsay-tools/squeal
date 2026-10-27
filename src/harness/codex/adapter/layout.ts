import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/*
 * Spec 002 D9 and `tasks/wave-4-contract.md` "Layout and identities": where
 * the fixed plugin's adapter keeps runtime state in Codex's `PLUGIN_DATA`.
 * Retained runtimes stay `versions/<version>/`, where spec 005 D3's copies
 * live; control files sit below `runtime/`. Every module of `adapter/`
 * imports only Node builtins and its siblings: it ships frozen in the fixed
 * plugin, so it cannot follow changing product modules.
 */

/** The one control-file schema this adapter writes and reads. */
export const SCHEMA = 1;

/** A runtime version: a plain release, and a safe directory name. */
export const VERSION = /^\d+\.\d+\.\d+$/;

/** `runtime/current.json`: the runtime a new session selects. */
export interface CurrentRecord {
  readonly schema: 1;
  readonly version: string;
}

/** `runtime/sessions/<sha256(session_id)>.json`: the runtime one session keeps. */
export interface PinRecord {
  readonly schema: 1;
  readonly sessionId: string;
  readonly version: string;
}

export const versionsDir = (data: string): string => join(data, "versions");
export const runtimeRoot = (data: string, version: string): string =>
  join(data, "versions", version);
export const currentFile = (data: string): string => join(data, "runtime", "current.json");
export const sessionsDir = (data: string): string => join(data, "runtime", "sessions");

/** The pin of `sessionId`; a session id never becomes a raw path component. */
export function pinFile(data: string, sessionId: string): string {
  return join(sessionsDir(data), `${sha256(sessionId)}.json`);
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** True when `version` is a plain release strictly newer than `than`. */
export function isNewer(version: string, than: string): boolean {
  const a = parts(version);
  const b = parts(than);
  if (a === null || b === null) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function parts(version: string): number[] | null {
  return VERSION.test(version) ? version.split(".").map(Number) : null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON file's value; `undefined` when absent, `null` when unreadable or not JSON. */
function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `current.json`: `null` when absent, `"invalid"` when it is no current record. */
export function readCurrent(data: string): CurrentRecord | "invalid" | null {
  const value = readJson(currentFile(data));
  if (value === undefined) return null;
  return isObject(value) &&
    value.schema === SCHEMA &&
    typeof value.version === "string" &&
    VERSION.test(value.version)
    ? { schema: SCHEMA, version: value.version }
    : "invalid";
}

/** A pin file: `null` when absent, `"invalid"` when it is no pin record. */
export function readPin(path: string): PinRecord | "invalid" | null {
  const value = readJson(path);
  if (value === undefined) return null;
  return isObject(value) &&
    value.schema === SCHEMA &&
    typeof value.sessionId === "string" &&
    typeof value.version === "string" &&
    VERSION.test(value.version)
    ? { schema: SCHEMA, sessionId: value.sessionId, version: value.version }
    : "invalid";
}

/** Every version a pin names. Unreadable pins name none. */
export function pinnedVersions(data: string): string[] {
  let names: string[];
  try {
    names = readdirSync(sessionsDir(data)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const versions = new Set<string>();
  for (const name of names) {
    const pin = readPin(join(sessionsDir(data), name));
    if (pin !== null && pin !== "invalid") versions.add(pin.version);
  }
  return [...versions].sort();
}

/**
 * The versions a prune must keep beyond spec 005 D3's own rule: the current
 * runtime and every pinned one (`wave-4-contract.md`). No age-only eviction:
 * a session that never sent SessionEnd keeps its runtime's disk space.
 */
export function protectedVersions(data: string): Set<string> {
  const keep = new Set(pinnedVersions(data));
  const current = readCurrent(data);
  if (current !== null && current !== "invalid") keep.add(current.version);
  return keep;
}

const part = (path: string) => `${path}.${process.pid}.${Date.now()}.tmp`;

/** Replaces `path` with `text` whole: written beside it, then renamed over it. */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = part(path);
  try {
    writeWhole(tmp, text);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Creates `path` with `text` whole, only when it does not exist: written
 * beside it, then hard-linked into place, which fails when another process
 * created it first. `false` then; a reader never sees half a record.
 */
export function createExclusive(path: string, text: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = part(path);
  try {
    writeWhole(tmp, text);
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
}

function writeWhole(path: string, text: string): void {
  // `wx`: a leftover of a killed process with this name is never reused half-written.
  rmSync(path, { force: true });
  writeFileSync(path, text, { flag: "wx", mode: 0o644 });
}
