import { createHash } from "node:crypto";
import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import type { CoreEnvironmentInputs, EnvironmentHash, FileHash } from "../types/keys.js";
import type { RunnerEnvironment } from "../types/runner.js";
import { KEY_FORMAT_VERSION } from "./key-format.js";

/** Bumped when the encoding below changes, so old keys can never collide with new ones. */
const ENVIRONMENT_ENCODING = "squeal-environment/1";

/**
 * Environment hash of one runner project in one worktree.
 *
 * Spec 001 D3: "the key format version and the runner-adapter version,
 * Vitest and Node versions, platform and arch, the resolved Vitest config, the contents of the
 * config file and its `configFileDependencies`, the closure of every
 * `setupFiles` and `globalSetup` entry, the installed-dependency fingerprint
 * [...], allow-listed environment variables". Env variables and runner files
 * are sorted, so their order does not matter. Fields are JSON-encoded, so no
 * two different inputs share an encoding. `core.squealVersion` is left out
 * (task 001-199): a release changes keys only through `KEY_FORMAT_VERSION` or
 * an adapter's version.
 *
 * `hashOf` hashes the runner files, normally `StatCache.hashOf`, so they get
 * the same file hash as closure paths (D3: "One definition everywhere"). `null`
 * is an absent file. `undefined` is a path the caller never hashed; it throws
 * rather than encoding an unknown file as absent. `format` is the key format
 * to hash under: a format read as one (`KEY_FORMATS_READ_AS_ONE`, task
 * 011-38) gives the hash a daemon at that format computed.
 */
export function environmentHash(
  core: CoreEnvironmentInputs,
  runner: RunnerEnvironment,
  hashOf: (path: RelativePath) => FileHash | null | undefined,
  format: number = KEY_FORMAT_VERSION,
): EnvironmentHash {
  const files = [...new Set(runner.files)].sort(compare).map((path) => {
    const hash = hashOf(path);
    if (hash === undefined) {
      throw new Error(
        `squeal: environment of project "${runner.project}": runner file "${path}" has not been hashed`,
      );
    }
    return [path, hash] as const;
  });
  const encoded = JSON.stringify([
    ENVIRONMENT_ENCODING,
    format,
    core.nodeVersion,
    core.platform,
    core.arch,
    core.installedDependencies,
    Object.entries(core.env).sort(([a], [b]) => compare(a, b)),
    runner.project,
    runner.runnerName,
    runner.runnerVersion,
    runner.adapterVersion,
    runner.resolvedConfig,
    files,
  ]);
  return createHash("sha256").update(encoded).digest("hex");
}
