import type {
  CoreEnvironmentInputs,
  FileHash,
  RelativePath,
  RunnerEnvironment,
  RunnerPackages,
  TestFileRef,
} from "../types/index.js";
import type { DependencyKeys } from "./dependencies.js";
import { environmentHash } from "./environment.js";
import { KEY_FORMAT_VERSION, KEY_FORMATS_READ_AS_ONE } from "./key-format.js";
import type { ReadAsOne } from "./key-index.js";

/**
 * The last format the definitions before tasks 011-85 and 011-162 keyed
 * at; a raise above it ends the read.
 */
const FORMER_LAST_FORMAT = 20;

/**
 * Task 011-85 R4 (011 C3, C4 step 3, C7): a project's environment hashes
 * under the key definition before 011-85, read as the current one. That
 * definition hashed npm's hidden lockfile and pnpm's `lock.yaml` whole, and
 * every Vitest project's config files and their packages
 * (`DependencyKeys.former`, `RunnerEnvironment.formerFiles`). Every input of
 * the current key is a function of those, so a row stored under one means
 * what a row under the current key means. One hash at the current format and
 * at each format read as one, each with the segment that definition gave a
 * test file over the packages `packagesOf` reports for it (review 0.1.253
 * B1); none where that definition's inputs are the current ones. A format
 * raise empties it with `KEY_FORMATS_READ_AS_ONE`.
 *
 * Task 011-162 R3: then the pnpm definition before 011-162, while
 * `lock.yaml` stands for the install (`DependencyKeys.formerPnpm`): the
 * current files, the whole fingerprint and no segment, at the current
 * format only, since its rows exist at format 20 alone (from 0.1.253).
 * They were stored with an absent path's `absentSegment` up to 0.1.284 and
 * without it from 0.1.285 (task 011-158), so it is read both ways
 * (`ReadAsOne.storedAfter158`).
 */
export function formerReadAsOne(
  core: CoreEnvironmentInputs,
  environment: RunnerEnvironment,
  dependencies: DependencyKeys | undefined,
  hashOf: (path: RelativePath) => FileHash | null | undefined,
  packagesOf: (testFile: TestFileRef) => RunnerPackages | undefined,
): ReadAsOne[] {
  const pnpm = dependencies?.formerPnpm ?? null;
  const pnpmRead = (pnpm === null ? [] : [KEY_FORMAT_VERSION])
    .filter((format) => format <= FORMER_LAST_FORMAT)
    .map((format) => ({
      ...readAt(core, environment, pnpm, hashOf, packagesOf, format),
      storedAfter158: true as const,
    }));
  const former = dependencies?.former ?? null;
  if (former === null && environment.formerFiles === undefined) return pnpmRead;
  const runner = { ...environment, files: environment.formerFiles ?? environment.files };
  return [
    ...[KEY_FORMAT_VERSION, ...Object.keys(KEY_FORMATS_READ_AS_ONE).map(Number)]
      .filter((format) => format <= FORMER_LAST_FORMAT)
      .map((format) => readAt(core, runner, former, hashOf, packagesOf, format)),
    ...pnpmRead,
  ];
}

/** The environment hash at `format` over `keys`' environment, each file with its segment of `keys`. */
function readAt(
  core: CoreEnvironmentInputs,
  runner: RunnerEnvironment,
  keys: DependencyKeys | null,
  hashOf: (path: RelativePath) => FileHash | null | undefined,
  packagesOf: (testFile: TestFileRef) => RunnerPackages | undefined,
  format: number,
): ReadAsOne {
  if (keys === null) return { environment: environmentHash(core, runner, hashOf, format) };
  const inputs = { ...core, installedDependencies: keys.environment };
  return {
    environment: environmentHash(inputs, runner, hashOf, format),
    segment: (testFile) => keys.of(packagesOf(testFile)),
  };
}
