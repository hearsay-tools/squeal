import { createHash } from "node:crypto";

/** pnpm's installed lockfile, relative to the directory that holds `node_modules`. */
export const PNPM_LOCKFILE = "node_modules/.pnpm/lock.yaml";

/**
 * Task 011-85, R3 (011 C11): pnpm's installed `lock.yaml` without the
 * `specifier` line of each dependency whose `version` is `link:`, the range
 * a release rewrites in every dependent of a linked workspace package. The
 * `version: link:` line stays, so a retargeted link still moves the
 * fingerprint, and so does every registry range. A text filter, not a
 * reading of the format: pnpm writes `specifier` right before `version` at
 * the same indent. Any other layout keeps every line, so the fingerprint
 * splits and never matches wrongly.
 */
export function withoutLinkedSpecifiers(text: string): string {
  const lines = text.split("\n");
  return lines.filter((line, at) => !linkedSpecifier(line, lines[at + 1] ?? "")).join("\n");
}

function linkedSpecifier(line: string, next: string): boolean {
  const indent = /^( +)specifier: /.exec(line)?.[1];
  return indent !== undefined && next.startsWith(`${indent}version: link:`);
}

/** The parts of pnpm's installed `lock.yaml` a per-package key reads (task 011-162). */
export interface PnpmLockfile {
  /**
   * Each importer (`.` the root, a workspace by its path): the names its
   * `dependencies`, `devDependencies` and `optionalDependencies` declare, to
   * the resolved version, `link:<path>` for a linked workspace.
   */
  readonly importers: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Each package's `resolution.integrity`, by `name@version`; absent for a resolution without one. */
  readonly integrity: ReadonlyMap<string, string>;
  /** Each snapshot's `dependencies` and `optionalDependencies`, resolved peers among them: name to ref. */
  readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const IMPORTER_FIELDS = new Set(["dependencies", "devDependencies", "optionalDependencies"]);
const SNAPSHOT_FIELDS = new Set(["dependencies", "optionalDependencies"]);

/**
 * Task 011-162 R1 (011 C11): the importers, integrities and snapshot edges
 * of pnpm's installed `lock.yaml`, read line by line in the layout pnpm
 * writes: two-space indents, one key per line, plain or single-quoted keys
 * and scalars, `resolution` as a one-line flow map, `{}` for an empty map.
 * Lines under any other part are skipped unread. `null` for a
 * `lockfileVersion` other than 9, a second document, or any line it does
 * not know where it reads, so the install keeps the whole fingerprint: a
 * split, never a wrong key.
 */
export function readPnpmLockfile(text: string): PnpmLockfile | null {
  const importers = new Map<string, Map<string, string>>();
  const integrity = new Map<string, string>();
  const snapshots = new Map<string, Map<string, string>>();
  let version = false;
  let section = "";
  /** The current importer's or snapshot's map, and its id. */
  let entry: Map<string, string> | null = null;
  let id = "";
  /** Inside a field the reader reads, and the importer dependency being read. */
  let reading = false;
  let dependency = "";
  for (const line of text.split("\n")) {
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const body = line.slice(indent);
    if (body === "" || body.startsWith("#")) continue;
    if (/^\s/.test(body) || indent % 2 !== 0) return null;
    if (indent === 0) {
      const pair = pairOf(body);
      if (pair === null) return null;
      if (pair[0] === "lockfileVersion") {
        if (!/^9\.\d+$/.test(pair[1])) return null;
        version = true;
      }
      section = pair[1] === "" ? pair[0] : "";
      [entry, id, reading] = [null, "", false];
      continue;
    }
    if (section === "packages") {
      if (indent > 4) continue;
      const pair = pairOf(body);
      if (pair === null) return null;
      if (indent === 2) id = pair[0];
      else if (pair[0] === "resolution") {
        const found = /^\{(?:.*[ ,])?integrity: ([^\s,}]+)[,}]/.exec(pair[1])?.[1];
        if (found !== undefined) integrity.set(id, found);
      }
      continue;
    }
    if (section !== "importers" && section !== "snapshots") continue;
    const deepest = section === "importers" ? 8 : 6;
    if (indent > 4 && !reading) continue;
    if (indent > deepest || body.startsWith("- ")) return null;
    const pair = pairOf(body);
    if (pair === null) return null;
    const [key, value] = pair;
    if (indent === 2) {
      if (value !== "" && value !== "{}") return null;
      id = key;
      entry = new Map();
      (section === "importers" ? importers : snapshots).set(key, entry);
      reading = false;
    } else if (entry === null) return null;
    else if (indent === 4) {
      reading = (section === "importers" ? IMPORTER_FIELDS : SNAPSHOT_FIELDS).has(key);
      if (reading && value !== "") return null;
    } else if (section === "snapshots") {
      if (!isRef(value) || !setOnce(entry, key, value)) return null;
    } else if (indent === 6) {
      if (value !== "") return null;
      dependency = key;
      if (!entry.has(key)) entry.set(key, "");
    } else if (key === "version") {
      if (!isRef(value) || !setOnce(entry, dependency, value)) return null;
    }
  }
  for (const declared of importers.values()) {
    for (const ref of declared.values()) if (ref === "") return null;
  }
  return version ? { importers, integrity, snapshots } : null;
}

/** A resolved version or edge: a scalar, never a nested or flow collection. */
function isRef(value: string): boolean {
  return value !== "" && !value.startsWith("{") && !value.startsWith("[");
}

/** Sets `name` once; a second, different value for it is a layout the reader does not know. */
function setOnce(map: Map<string, string>, name: string, value: string): boolean {
  const known = map.get(name);
  if (known !== undefined && known !== "" && known !== value) return false;
  map.set(name, value);
  return true;
}

/**
 * `key: value` as pnpm writes it: a plain or single-quoted key, then a
 * plain or single-quoted scalar, a one-line flow collection, or nothing.
 * `null` for a double-quoted key or value, or a line with no key.
 */
function pairOf(body: string): readonly [string, string] | null {
  let key: string;
  let rest: string;
  if (body.startsWith("'")) {
    const quoted = singleQuoted(body);
    if (quoted === null) return null;
    [key, rest] = quoted;
  } else {
    const at = body.search(/:(?: |$)/);
    if (at <= 0 || body.startsWith('"')) return null;
    key = body.slice(0, at);
    rest = body.slice(at);
  }
  if (rest !== ":" && !rest.startsWith(": ")) return null;
  const value = rest.slice(1).trim();
  if (value.startsWith('"')) return null;
  if (!value.startsWith("'")) return [key, value];
  const quoted = singleQuoted(value);
  return quoted === null || quoted[1] !== "" ? null : [key, quoted[0]];
}

/** A single-quoted scalar at the start of `text`, unescaped, and the text after it. */
function singleQuoted(text: string): readonly [string, string] | null {
  const quoted = /^'((?:[^']|'')*)'/.exec(text);
  const [all, inner] = quoted ?? [];
  return all === undefined || inner === undefined
    ? null
    : [inner.replaceAll("''", "'"), text.slice(all.length)];
}

/**
 * The folder pnpm gives a snapshot under `node_modules/.pnpm` (task
 * 011-162): `depPathToFilename` of pnpm 10.32.0, which names every folder
 * pnpm 12.11.2 wrote for cezar. `/`, `:` and the like become `+`, a peer
 * suffix `(…)` becomes `_…`, and a name longer than `max` (`.modules.yaml`'s
 * `virtualStoreDirMaxLength`) or with capitals is cut and ends in `_` and 32
 * hex digits of its SHA-256.
 */
export function pnpmFolderName(id: string, max: number): string {
  let name = id.replace(/[\\/:*?"<>|#]/g, "+");
  if (name.includes("(")) name = name.replace(/\)$/, "").replace(/\)\(|\(|\)/g, "_");
  if (name.length > max || (name !== name.toLowerCase() && !name.startsWith("file+"))) {
    const digest = createHash("sha256").update(name).digest("hex");
    return `${name.slice(0, max - 33)}_${digest.slice(0, 32)}`;
  }
  return name;
}
