import type {
  CoreEnvironmentInputs,
  FileHash,
  RelativePath,
  RunnerEnvironment,
} from "../types/index.js";
import type { DependencyKeys } from "./dependencies.js";
import { environmentHash } from "./environment.js";
import { KEY_FORMAT_VERSION, KEY_FORMATS_READ_AS_ONE } from "./key-format.js";
import type { ReadAsOne } from "./key-index.js";

/** The last format the definition before task 011-85 keyed at; a raise above it ends the read. */
const FORMER_LAST_FORMAT = 20;

/**
 * Task 011-85 R4 (011 C3, C4 step 3, C7): a project's environment hashes
 * under the key definition before 011-85, read as the current one. That
 * definition hashed npm's hidden lockfile and pnpm's `lock.yaml` whole
 * (`DependencyKeys.former`) and every Vitest project's config files
 * (`RunnerEnvironment.formerFiles`). Every input of the current key is a
 * function of those, so a row stored under one means what a row under the
 * current key means. One hash at the current format and at each format read
 * as one, each with the segment a test file keyed by the whole fingerprint
 * read then; none where that definition's inputs are the current ones. A
 * format raise empties it with `KEY_FORMATS_READ_AS_ONE`.
 */
export function formerReadAsOne(
  core: CoreEnvironmentInputs,
  environment: RunnerEnvironment,
  dependencies: DependencyKeys | undefined,
  hashOf: (path: RelativePath) => FileHash | null | undefined,
): ReadAsOne[] {
  const former = dependencies?.former ?? null;
  if (former === null && environment.formerFiles === undefined) return [];
  const inputs = former === null ? core : { ...core, installedDependencies: former.environment };
  const runner = { ...environment, files: environment.formerFiles ?? environment.files };
  const segment = former === null ? {} : { segment: former.segment };
  return [KEY_FORMAT_VERSION, ...Object.keys(KEY_FORMATS_READ_AS_ONE).map(Number)]
    .filter((format) => format <= FORMER_LAST_FORMAT)
    .map((format) => ({
      environment: environmentHash(inputs, runner, hashOf, format),
      ...segment,
    }));
}
