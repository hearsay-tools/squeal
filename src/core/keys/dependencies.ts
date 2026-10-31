import { createHash } from "node:crypto";
import type { PackageImport, RunnerPackages } from "../types/index.js";
import type { InstalledDependencies } from "./environment.js";
import { OPAQUE_BUILTINS } from "./packages.js";

/** Bumped when the encodings below change. */
const SCOPED_ENCODING = "squeal-installed-scoped/1";
const PACKAGES_ENCODING = "squeal-packages/1";

/** How one project's installed dependencies enter its environment hash and its check keys. */
export interface DependencyKeys {
  /** The installed-dependency input of the environment hash. */
  readonly environment: string;
  /** The installed-dependency segment of one test file's key. */
  of(packages: RunnerPackages | undefined): string;
}

/**
 * Spec 001 D3 as amended by task 001-105 (scheme B of
 * `research/per-package-keys.md`). With a package graph and the runner's
 * environment-wide packages, the environment hash holds the lockfile closure
 * of those packages plus the patches, and each test file's key adds the
 * closure of the packages its own closure imports, without the environment's.
 * A test file whose runner reports no packages, or whose closure imports
 * `child_process`, `worker_threads`, `module` or `cluster`, or whose package
 * set holds an opaque package (one whose code reaches such a builtin; task
 * 001-109), keys by the whole fingerprint, as before. Without a graph
 * (another lockfile format, a stale hidden lockfile) or without
 * environment-wide packages, or when those import such a builtin or hold an
 * opaque package outside the runner's own closure, the environment hash
 * holds the whole fingerprint and no test file adds anything.
 */
export function dependencyKeys(
  installed: InstalledDependencies,
  environment: RunnerPackages | undefined,
): DependencyKeys {
  const { graph, fingerprint } = installed;
  if (graph === null || environment === undefined || isOpaque(environment)) {
    return { environment: fingerprint, of: () => "" };
  }
  const shared = graph.identities(environment.imports);
  const runner = new Set(graph.identities(environment.runner ?? []));
  if (graph.opaque(shared.filter((identity) => !runner.has(identity)))) {
    return { environment: fingerprint, of: () => "" };
  }
  const excluded = new Set(shared);
  // Review wave-11d S2: a test's opacity is judged on the whole closure of
  // what it imports, shared or not; only its imports of the runner's own
  // packages are exempt, as the environment's are.
  const started = (entry: PackageImport) => graph.identities([{ ...entry, manifest: true }]).join();
  const runnerStarts = new Set((environment.runner ?? []).map(started));
  const whole = `whole:${fingerprint}`;
  return {
    environment: hash([SCOPED_ENCODING, shared, installed.patches]),
    of: (packages) => {
      if (packages === undefined || isOpaque(packages)) return whole;
      const own = packages.imports.filter((entry) => !runnerStarts.has(started(entry)));
      if (graph.opaque(graph.identities(own))) return whole;
      return hash([PACKAGES_ENCODING, graph.identities(packages.imports, excluded)]);
    },
  };
}

function isOpaque(packages: RunnerPackages): boolean {
  return packages.builtins.some((name) => OPAQUE_BUILTINS.has(name));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
