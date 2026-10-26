import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import type { build } from "esbuild";
import { compare } from "../../../src/core/fs/index.js";
import { childOf } from "../../../src/core/keys/pnpm-graph.js";
import { type PnpmLockfile, readPnpmLockfile } from "../../../src/core/keys/pnpm-lockfile.js";

/*
 * Risk 9 of task 011-37 (design section 6): a package an entry imports, or
 * the bundler, moved since the last release. Both bundles would then run on
 * the candidate's install and be built by its esbuild, which compares
 * nothing the release shipped. The comparison installs the release's own
 * lock into its extracted tree instead, and bundles and runs that side from
 * there.
 *
 * Row 017-11: the repository installs with pnpm; releases before it hold
 * npm's lock. Either lock reads as one graph, so a release and a candidate
 * at the same packages compare equal across the two formats.
 */

/** The lockfile each package manager writes; a tree holds exactly one. */
export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml"] as const;
export type Lockfile = (typeof LOCKFILES)[number];

/** The one lockfile `has` finds in `where`; throws for none or both. */
export function lockfileIn(where: string, has: (path: Lockfile) => boolean): Lockfile {
  const held = LOCKFILES.filter(has);
  const [only] = held;
  if (only === undefined || held.length > 1) {
    throw new Error(`${where}: ${held.length} of ${LOCKFILES.join(" and ")}; it reads exactly one`);
  }
  return only;
}

/** Installs `tree`'s own lock into it. */
export type Install = (tree: string) => void;

/**
 * The tree's lock, its scripts off as a candidate tree's install runs here:
 * `npm ci` of npm's, or `pnpm install --frozen-lockfile` of pnpm's by the
 * pnpm its `packageManager` names. esbuild's binary comes from its platform
 * package, which neither install skips.
 */
export const installLock: Install = (tree) => {
  const run = (command: string, args: readonly string[]) =>
    execFileSync(command, args, { cwd: tree, encoding: "utf8", stdio: "pipe", timeout: 600_000 });
  if (lockfileIn(tree, (path) => existsSync(join(tree, path))) === "package-lock.json") {
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"]);
    return;
  }
  const manifest = JSON.parse(readFileSync(join(tree, "package.json"), "utf8")) as {
    packageManager?: string;
  };
  const pinned = /^pnpm@(\d+\.\d+\.\d+)/.exec(manifest.packageManager ?? "")?.[1];
  if (pinned === undefined) throw new Error(`${tree}/package.json: no pnpm in packageManager`);
  const running = run("pnpm", ["--version"]).trim();
  if (running !== pinned) {
    throw new Error(`${tree}/package.json names pnpm ${pinned}; pnpm runs ${running} there`);
  }
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline"]);
};

/** The esbuild `tree` installed. */
export async function esbuildOf(tree: string): Promise<typeof build> {
  const main = pathToFileURL(join(tree, "node_modules/esbuild/lib/main.js")).href;
  return ((await import(main)) as { build: typeof build }).build;
}

/** A lock's packages as Node loads them: from the root (`null`) or a package, a name resolves to one node. */
export interface LockGraph {
  /** The node `name` resolves to from `from`, or `null` when the lock holds none. */
  resolve(from: string | null, name: string): string | null;
  /** `name@version#integrity` of `node`; throws when the lock records no version or integrity. */
  identity(node: string): string;
  /** The names `node` imports, each with whether the lock must resolve it. */
  edges(node: string): ReadonlyMap<string, boolean>;
}

interface NpmEntry {
  readonly name?: string;
  readonly version?: string;
  readonly integrity?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

function identityOf(where: string, node: string, name: string, version?: string, sri?: string) {
  if (version === undefined || sri === undefined) {
    throw new Error(`${where}: ${node} records no version or no integrity`);
  }
  return `${name}@${version}#${sri}`;
}

/** Where Node finds `name` from the package at `from` ("" is the root), in npm's lock. */
function locate(packages: Record<string, NpmEntry>, from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const location = posix.join(dir, "node_modules", name);
    if (packages[location] !== undefined) return location;
    if (dir === "") return null;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at < 0 ? "" : dir.slice(0, at);
  }
}

/** npm's lock (versions 2 and 3): a node is a location. */
function npmGraph(text: string, where: string): LockGraph {
  const lock = JSON.parse(text) as {
    lockfileVersion?: unknown;
    packages?: Record<string, NpmEntry>;
  };
  const { packages } = lock;
  if ((lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || packages === undefined) {
    throw new Error(`${where}: lockfileVersion ${String(lock.lockfileVersion)}; it reads 2 and 3`);
  }
  return {
    resolve: (from, name) => locate(packages, from ?? "", name),
    identity: (location) => {
      const { name, version, integrity } = packages[location] ?? {};
      const own = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
      return identityOf(where, location, name ?? own, version, integrity);
    },
    edges: (location) => {
      const entry = packages[location] ?? {};
      const edges = new Map<string, boolean>();
      for (const dep of Object.keys({ ...entry.optionalDependencies, ...entry.peerDependencies }))
        edges.set(dep, false);
      for (const dep of Object.keys(entry.dependencies ?? {})) edges.set(dep, true);
      return edges;
    },
  };
}

/** The one document of pnpm's lock the key reader reads; pnpm 12 writes its own pin in another. */
export function pnpmProject(text: string, where: string): PnpmLockfile {
  const read = text.split(/^---\n/m).flatMap((doc) => readPnpmLockfile(doc) ?? []);
  const [lock] = read;
  if (lock === undefined || read.length > 1 || !lock.importers.has(".")) {
    throw new Error(
      `${where}: not one pnpm lockfile document src/core/keys/pnpm-lockfile.ts reads`,
    );
  }
  return lock;
}

/** pnpm's lock: a node is a snapshot, whose edges hold its resolved peers. */
function pnpmGraph(text: string, where: string): LockGraph {
  const lock = pnpmProject(text, where);
  return {
    resolve: (from, name) => {
      const ref = (from === null ? lock.importers.get(".") : lock.snapshots.get(from))?.get(name);
      if (ref === undefined) return null;
      const id = childOf(name, ref);
      if (!lock.snapshots.has(id)) {
        throw new Error(`${where}: ${name} (from "${from ?? ""}") is ${id}, which has no snapshot`);
      }
      return id;
    },
    identity: (id) => {
      const name = id.slice(0, id.indexOf("@", 1));
      const version = id.slice(name.length + 1).replace(/\(.*$/, "");
      return identityOf(where, id, name, version, lock.integrity.get(`${name}@${version}`));
    },
    edges: (id) => new Map([...(lock.snapshots.get(id)?.keys() ?? [])].map((dep) => [dep, true])),
  };
}

/** `file`'s text as a graph. */
export function lockGraph(file: Lockfile, text: string, where: string): LockGraph {
  return file === "package-lock.json" ? npmGraph(text, where) : pnpmGraph(text, where);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Each node of the closure of `roots` in `graph` with the node each of its names loads, the roots' under `.`. */
function closureOf(graph: LockGraph, roots: Iterable<string>, where: string) {
  const imports = new Map<string, [string, string][]>();
  const visit = (from: string | null, name: string, required: boolean): string | null => {
    const node = graph.resolve(from, name);
    if (node === null) {
      if (required) throw new Error(`${where}: ${name} (from "${from ?? ""}") not found`);
      return null;
    }
    if (imports.has(node)) return node;
    const out: [string, string][] = [];
    imports.set(node, out);
    for (const [dep, must] of graph.edges(node)) {
      const target = visit(node, dep, must);
      if (target !== null) out.push([dep, target]);
    }
    return node;
  };
  const top = [...new Set(roots)].map((name): [string, string] => [
    name,
    visit(null, name, true) ?? "",
  ]);
  return { top, imports };
}

/**
 * Each node's class: its identity, then refined by the classes its names
 * load until no class splits. Two nodes share a class when they load the
 * same packages all the way down, whichever lock and place holds them.
 */
function classesOf(
  identity: ReadonlyMap<string, string>,
  imports: Map<string, [string, string][]>,
) {
  let label: ReadonlyMap<string, string> = identity;
  for (let classes = new Set(label.values()).size; ; ) {
    const before = label;
    label = new Map(
      [...imports].map(([node, out]) => {
        const loads = out.map(([dep, to]) => `${dep}=${before.get(to)}`).sort(compare);
        return [node, sha256([before.get(node), ...loads].join("\n"))];
      }),
    );
    const now = new Set(label.values()).size;
    if (now === classes) return label;
    classes = now;
  }
}

/**
 * The closure of `roots` in `graph`, one line per class of nodes that load
 * the same code (`classesOf`): `name@version#integrity`, its number of
 * copies when more than one, then each import as `name=name@version` of the
 * class it loads; the line `.` holds the roots' imports. A line holds what
 * loads below it, not where a lock put it, so npm's lock and pnpm's give
 * the same lines for the same packages; a package that loads another copy,
 * or a copy more or fewer, moves one. A class whose `name@version` another
 * class shares is followed by `~n`, its rank among them. A required name
 * not found throws.
 */
export function closureLines(graph: LockGraph, roots: Iterable<string>, where: string): string[] {
  const { top, imports } = closureOf(graph, roots, where);
  const identity = new Map([...imports.keys()].map((node) => [node, graph.identity(node)]));
  const label = classesOf(identity, imports);
  const copies = new Map<string, string[]>();
  for (const [node, at = ""] of label) copies.set(at, [...(copies.get(at) ?? []), node]);
  const ranked = [...copies].sort(([a], [b]) => compare(a, b));
  const version = (node = "") => (identity.get(node) ?? "").replace(/#.*$/, "");
  const suffix = new Map<string, string>();
  for (const [at, [node]] of ranked) {
    const same = ranked.filter(([, [other]]) => version(other) === version(node));
    suffix.set(at, same.length > 1 ? `~${same.findIndex(([other]) => other === at)}` : "");
  }
  const loads = (out: [string, string][]) =>
    out.map(([dep, to]) => `${dep}=${version(to)}${suffix.get(label.get(to) ?? "")}`).sort(compare);
  const lines = ranked.map(([at, [node = "", ...more]]) => {
    const own = `${identity.get(node)}${suffix.get(at)}${more.length > 0 ? ` x${more.length + 1}` : ""}`;
    return [own, ...loads(imports.get(node) ?? [])].join(" ");
  });
  return [[".", ...loads(top)].join(" "), ...lines].sort(compare);
}
