import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { compare } from "../../src/core/fs/index.js";
import { bundleOptions } from "../../src/harness/claude-code/build.js";

/*
 * What the key-format guard hashes (spec 001 D3, task 001-203): everything
 * that can change what a stored result means or whether one is accepted, so
 * the guard covers by default and leaves out only what `EXEMPT` names. That
 * is all of `src/`, the build's inputs outside it, and a fingerprint of the
 * third-party code the build embeds. Forgetting an exemption costs a re-key;
 * forgetting a source would trust a result whose meaning changed.
 */

export const ROOT = join(import.meta.dirname, "../..");

/** Hashed whole, a directory with every file below it. */
export const GUARDED: readonly string[] = [
  "src",
  // esbuild reads its compiler options (`verbatimModuleSyntax`, class fields) when bundling.
  "tsconfig.json",
  // How the shipped CLI, and a daemon `squeal start` spawns from it, runs Node.
  "plugins/claude-code/bin",
  // `type: module` for the bundles; its version is dropped below.
  "plugins/claude-code/package.json",
  // Which build runs (`build:plugin`), and the ranges the lock resolves; version dropped below.
  "package.json",
  // Replaced by `bundledDependencies`: only the packages the bundles embed, and the bundler.
  "package-lock.json",
];

/** Paths under `GUARDED` left out, each with why it cannot change what is stored or accepted. */
export const EXEMPT: Readonly<Record<string, string>> = {
  "src/core/keys/key-format.ts":
    "the pin itself; KEY_FORMAT_VERSION enters every environment hash directly",
  "src/runners/vitest/version.ts":
    "VITEST_ADAPTER_VERSION alone, which re-keys the Vitest runner's checks itself (D4)",
  "src/runners/node-test/version.ts":
    "NODE_TEST_ADAPTER_VERSION alone, which re-keys the node:test runner's checks itself (D4)",
  "src/cli":
    "commands that ask a daemon, read the store or edit user files, and their wording; none keys, runs or records",
  "src/core/status": "`squeal status` and `why`: read the store and render it, write nothing",
  "src/core/delivery":
    "consumer views, deltas and messages: read results and known states, write consumer rows, views and meta slots",
  "src/harness":
    "hook adapters and their text: register, deliver, deny and wait; a daemon starts through core/daemon/ensure.ts",
};

/** Paths inside an `EXEMPT` directory that stay guarded, each with why. */
export const GUARDED_WITHIN: Readonly<Record<string, string>> = {
  "src/cli/index.ts": "the daemon process's entry",
  "src/cli/main.ts": "dispatches `squeal daemon` with its arguments",
  "src/cli/daemon.ts": "starts the daemon, deciding its working directory and lock wait",
  "src/harness/build.ts": "what the bundles hold, how they are built and which runtime files ship",
  "src/harness/claude-code/build.ts": "the Claude Code plugin's build",
  "src/harness/codex/build.ts": "the Codex plugin's build",
};

/** Manifest fields dropped before hashing, each with why. */
export const DROPPED_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "package.json": {
    version: "the release: D10 steps down by it, no key holds it (001-199)",
    devDependencies:
      "tools; the bundler's lock entry is fingerprinted instead, the rest never reach a bundle",
  },
  "plugins/claude-code/package.json": { version: "the release, written by the build" },
};

/** The bundler, fingerprinted beside the embedded packages: its output is the shipped code. */
const BUNDLER = "esbuild";

/** A file's replacement text, or `null` for a deleted one, for checking a change unmade. */
export type Overlay = Readonly<Record<string, string | null>>;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function isExempt(path: string): boolean {
  if (Object.keys(GUARDED_WITHIN).includes(path)) return false;
  return Object.keys(EXEMPT).some((prefix) => under(path, prefix));
}

function filesBelow(root: string, path: string): string[] {
  if (!existsSync(join(root, path))) return [];
  if (!statSync(join(root, path)).isDirectory()) return [path];
  return readdirSync(join(root, path), { recursive: true, encoding: "utf8" })
    .map((entry) => `${path}/${entry.split("\\").join("/")}`)
    .filter((entry) => statSync(join(root, entry)).isFile());
}

/** Every guarded path, sorted, with the overlay's additions and deletions. */
export function guardedFiles(root = ROOT, overlay: Overlay = {}): string[] {
  const onDisk = GUARDED.flatMap((path) => filesBelow(root, path));
  const added = Object.keys(overlay).filter((path) => GUARDED.some((g) => under(path, g)));
  return [...new Set([...onDisk, ...added])]
    .filter((path) => overlay[path] !== null && !isExempt(path))
    .sort(compare);
}

function textOf(root: string, path: string, overlay: Overlay): string {
  const text = overlay[path] ?? readFileSync(join(root, path), "utf8");
  return text.replaceAll("\r\n", "\n");
}

interface LockEntry {
  readonly version?: string;
  readonly integrity?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Where Node finds `name` from the package at `from` ("" is the root), in the lock. */
function locate(packages: Record<string, LockEntry>, from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const location = posix.join(dir, "node_modules", name);
    if (packages[location] !== undefined) return location;
    if (dir === "") return null;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at < 0 ? "" : dir.slice(0, at);
  }
}

/**
 * `location@version#integrity` of every package the bundles embed, the lock
 * closure of the root's dependencies less the build's externals, and of the
 * bundler. The root's own version is not among them.
 */
export function bundledDependencies(lockText: string): string[] {
  const packages = (JSON.parse(lockText) as { packages: Record<string, LockEntry> }).packages;
  const external = (bundleOptions("").external ?? []).filter((name) => !name.includes("*"));
  const root = packages[""] ?? {};
  const names = Object.keys({ ...root.dependencies, ...root.optionalDependencies });
  const seen = new Set<string>();
  const visit = (from: string, name: string, required: boolean) => {
    const location = locate(packages, from, name);
    if (location === null) {
      if (required) throw new Error(`package-lock.json: ${name} (from "${from}") not found`);
      return;
    }
    if (seen.has(location)) return;
    seen.add(location);
    const entry = packages[location] ?? {};
    for (const dep of Object.keys(entry.dependencies ?? {})) visit(location, dep, true);
    for (const dep of Object.keys({ ...entry.optionalDependencies, ...entry.peerDependencies })) {
      visit(location, dep, false);
    }
  };
  for (const name of names.filter((n) => !external.includes(n))) visit("", name, true);
  visit("", BUNDLER, true);
  return [...seen].sort(compare).map((location) => {
    const { version, integrity } = packages[location] ?? {};
    return `${location}@${version}#${integrity}`;
  });
}

/** A guarded file's hashed text: a manifest without its dropped fields, the lock as its fingerprint. */
function hashedText(root: string, path: string, overlay: Overlay): string {
  const text = textOf(root, path, overlay);
  if (path === "package-lock.json") return `${bundledDependencies(text).join("\n")}\n`;
  const dropped = DROPPED_FIELDS[path];
  if (dropped === undefined) return text;
  const manifest = JSON.parse(text) as Record<string, unknown>;
  for (const field of Object.keys(dropped)) delete manifest[field];
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The guard's hash: paths and hashed texts, line endings normalized so a CRLF checkout hashes alike. */
export function keySourcesHash(root = ROOT, overlay: Overlay = {}): string {
  const hash = createHash("sha256");
  for (const path of guardedFiles(root, overlay)) {
    const text = hashedText(root, path, overlay);
    hash.update(`${path}\0${Buffer.byteLength(text)}\0`).update(text);
  }
  return hash.digest("hex");
}

/**
 * Each relative import of a guarded source that lands on an exempt one, as
 * `from -> to`: the places where exempt code could reach a key or a result.
 */
export function guardedImportsOfExempt(root = ROOT): string[] {
  const edges: string[] = [];
  // `GUARDED_WITHIN`'s CLI entry dispatches to every command; only `squeal daemon` runs a daemon.
  const sources = guardedFiles(root).filter(
    (path) => /^src\/.*\.(ts|mjs|cjs)$/.test(path) && GUARDED_WITHIN[path] === undefined,
  );
  for (const from of sources) {
    const text = readFileSync(join(root, from), "utf8");
    for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)) {
      const target = posix.join(dirname(from), match[1] ?? "").replace(/\.js$/, ".ts");
      const to = existsSync(join(root, target)) ? target : `${target}/index.ts`;
      if (isExempt(to)) edges.push(`${from} -> ${to}`);
    }
  }
  return [...new Set(edges)].sort(compare);
}
