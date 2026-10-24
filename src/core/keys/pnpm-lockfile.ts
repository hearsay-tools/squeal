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
 * The keys pnpm writes that no key reads (`convertToLockfileFile` of pnpm
 * 10.32.0, and every key of cezar's file under pnpm 12.11.2), per part.
 * The reader passes over these and their lines; any other key is a layout
 * it does not know (review 0.1.282 B1).
 */
const UNREAD = {
  root: new Set([
    "settings",
    "catalogs",
    "overrides",
    "packageExtensionsChecksum",
    "pnpmfileChecksum",
    "patchedDependencies",
    "ignoredOptionalDependencies",
    "time",
  ]),
  importers: new Set(["dependenciesMeta", "publishDirectory"]),
  packages: new Set([
    "bundledDependencies",
    "cpu",
    "deprecated",
    "engines",
    "hasBin",
    "libc",
    "name",
    "os",
    "peerDependencies",
    "peerDependenciesMeta",
    "version",
  ]),
  snapshots: new Set(["transitivePeerDependencies", "optional", "id"]),
};

/** The top-level parts the reader reads. */
type Part = "importers" | "packages" | "snapshots";

/** What `readPnpmLockfile` has read so far, and where it is. */
interface Reader {
  readonly importers: Map<string, Map<string, string>>;
  readonly integrity: Map<string, string>;
  readonly snapshots: Map<string, Map<string, string>>;
  version: boolean;
  /** The part the current top-level key opened, `null` for a key the reader passes over. */
  part: Part | null;
  /** The current importer's or snapshot's map. */
  entry: Map<string, string> | null;
  /** The current package's id. */
  id: string;
  /** Inside a field the reader reads, and the importer dependency being read. */
  reading: boolean;
  dependency: string;
}

/**
 * Task 011-162 R1 (011 C11): the importers, integrities and snapshot edges
 * of pnpm's installed `lock.yaml`, read line by line in the layout pnpm
 * writes: two-space indents, one key per line, plain or single-quoted keys
 * and scalars, `resolution` as a one-line flow map, `{}` for an empty
 * importer or snapshot. Lines under a key in `UNREAD` are skipped unread.
 * `null` for a `lockfileVersion` other than 9, a second document, no root
 * importer, or any other line it does not know, so the install keeps the
 * whole fingerprint: a split, never a wrong key. Each kind of line has its
 * reader (row 011-190); each answers `false` for a line it does not know.
 */
export function readPnpmLockfile(text: string): PnpmLockfile | null {
  const reader: Reader = {
    importers: new Map(),
    integrity: new Map(),
    snapshots: new Map(),
    version: false,
    part: null,
    entry: null,
    id: "",
    reading: false,
    dependency: "",
  };
  for (const line of text.split("\n")) {
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const body = line.slice(indent);
    if (body === "" || body.startsWith("#")) continue;
    if (/^\s/.test(body) || indent % 2 !== 0) return null;
    const known =
      indent === 0
        ? readTopLevel(reader, body)
        : reader.part === "packages"
          ? readPackageLine(reader, indent, body)
          : reader.part === null || readEntryLine(reader, reader.part, indent, body);
    if (!known) return null;
  }
  return lockfileOf(reader);
}

/** A top-level key: `lockfileVersion`, a part the reader reads, or a key in `UNREAD.root`. */
function readTopLevel(reader: Reader, body: string): boolean {
  const pair = pairOf(body);
  if (pair === null) return false;
  const [key, value] = pair;
  if (key === "lockfileVersion") {
    if (!/^9\.\d+$/.test(value)) return false;
    reader.version = true;
  } else if (!UNREAD.root.has(key) && (!isPart(key) || value !== "")) return false;
  reader.part = isPart(key) ? key : null;
  [reader.entry, reader.id, reader.reading] = [null, "", false];
  return true;
}

/** A `packages` line: a package's id, its `resolution`, or a key in `UNREAD.packages`. */
function readPackageLine(reader: Reader, indent: number, body: string): boolean {
  if (indent > 4) return true;
  const pair = pairOf(body);
  if (pair === null) return false;
  const [key, value] = pair;
  if (indent === 2) {
    if (value !== "") return false;
    reader.id = key;
  } else if (key === "resolution") {
    if (!value.startsWith("{")) return false;
    const found = /^\{(?:.*[ ,])?integrity: ([^\s,}]+)[,}]/.exec(value)?.[1];
    if (found !== undefined) reader.integrity.set(reader.id, found);
  } else if (!UNREAD.packages.has(key)) return false;
  return true;
}

/** An `importers` or `snapshots` line: an entry, one of its fields, or a line under a field read. */
function readEntryLine(
  reader: Reader,
  part: "importers" | "snapshots",
  indent: number,
  body: string,
): boolean {
  if (indent > 4 && !reader.reading) return true;
  if (indent > (part === "importers" ? 8 : 6) || body.startsWith("- ")) return false;
  const pair = pairOf(body);
  if (pair === null) return false;
  const [key, value] = pair;
  if (indent === 2) {
    if (value !== "" && value !== "{}") return false;
    reader.entry = new Map();
    reader[part].set(key, reader.entry);
    reader.reading = false;
    return true;
  }
  const { entry } = reader;
  if (entry === null) return false;
  if (indent === 4) {
    reader.reading = (part === "importers" ? IMPORTER_FIELDS : SNAPSHOT_FIELDS).has(key);
    return reader.reading ? value === "" : UNREAD[part].has(key);
  }
  if (part === "snapshots") return isRef(value) && setOnce(entry, key, value);
  return readDependencyLine(reader, entry, indent, pair);
}

/** An importer dependency's name, then its `version` and `specifier`. */
function readDependencyLine(
  reader: Reader,
  entry: Map<string, string>,
  indent: number,
  [key, value]: readonly [string, string],
): boolean {
  if (indent === 6) {
    if (value !== "") return false;
    reader.dependency = key;
    if (!entry.has(key)) entry.set(key, "");
    return true;
  }
  if (key === "version") return isRef(value) && setOnce(entry, reader.dependency, value);
  return key === "specifier";
}

/** The parts read, or `null` for no `lockfileVersion`, no root importer, or a name with no version. */
function lockfileOf({ version, importers, integrity, snapshots }: Reader): PnpmLockfile | null {
  for (const declared of importers.values()) {
    for (const ref of declared.values()) if (ref === "") return null;
  }
  return version && importers.has(".") ? { importers, integrity, snapshots } : null;
}

/** A top-level part the reader reads. */
function isPart(key: string): key is Part {
  return key === "importers" || key === "packages" || key === "snapshots";
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
