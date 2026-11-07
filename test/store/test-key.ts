import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readObjectFormat } from "../../src/core/hash/git-index.js";
import { seedStatCache } from "../../src/core/hash/hasher.js";
import { StatCache } from "../../src/core/hash/stat-cache.js";
import { assembleClosure } from "../../src/core/keys/closure.js";
import { coreEnvironmentInputs } from "../../src/core/keys/environment.js";
import { environmentHash } from "../../src/core/keys/environment-hash.js";
import { KeyIndex } from "../../src/core/keys/key-index.js";
import type { RelativePath } from "../../src/core/types/common.js";
import type { FileHash } from "../../src/core/types/keys.js";
import type { RunnerClosure, RunnerEnvironment } from "../../src/core/types/runner.js";

/*
 * R2: the keys a daemon gives a real adapter's closures and environments,
 * with the real key code: a stat cache seeded from the files on disk, the
 * environment hash, and the key index (`test/integration/key-stability`).
 */

const listFiles = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? listFiles(root, path)
      : [relative(root, path).split(sep).join("/")];
  });

export interface Keyed {
  readonly index: KeyIndex;
  readonly hashOf: (path: RelativePath) => FileHash | null | undefined;
}

/** The key index of `closures` under `environments`, from the files at `root` now. */
export async function keyed(
  root: string,
  environments: readonly RunnerEnvironment[],
  closures: readonly RunnerClosure[],
): Promise<Keyed> {
  const cache = new StatCache();
  const paths = new Set([
    ...listFiles(root),
    ...environments.flatMap((e) => e.files),
    ...closures.flatMap((c) => c.paths),
  ]);
  await seedStatCache(cache, root, [...paths], { objectFormat: await readObjectFormat(root) });
  const hashOf = (path: RelativePath) => cache.hashOf(path);
  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0",
    installedDependencies: "deps",
    allowlist: [],
  });
  const index = new KeyIndex(hashOf);
  for (const env of environments) {
    index.setEnvironment(env.project, environmentHash(core, env, hashOf));
  }
  for (const closure of closures) index.setClosure(assembleClosure(closure, []));
  return { index, hashOf };
}
