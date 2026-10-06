import { sep } from "node:path";
import type { SerializedError, Vitest } from "vitest/node";
import type { AbsolutePath } from "../../core/types/index.js";
import type { WorktreePaths } from "./paths.js";
import { errorText, type RunCollector } from "./reporter.js";

/**
 * Where an instance keeps its own files: the directories the forks pool
 * copies transformed modules into (`TestProject.tmpDir`, and Vitest's
 * internal `_tmpDir` for the root). Read when the instance starts, because
 * `close()` clears `_tmpDir`.
 */
export function instanceTempDirs(vitest: Vitest): AbsolutePath[] {
  const root = (vitest as unknown as { _tmpDir?: unknown })._tmpDir;
  const dirs = vitest.projects.map((p) => p.tmpDir);
  if (typeof root === "string") dirs.push(root);
  return [...new Set(dirs)];
}

/** What a file-level error is judged against. */
export interface InstanceFiles {
  readonly paths: WorktreePaths;
  readonly tempDirs: readonly AbsolutePath[];
}

/**
 * The first line of the first error of the run that the runner's own module
 * loading raised, or `null`; the run log has the whole error. Spec 001 D5: such an error says the instance is broken, not
 * that a test failed, so the run is a runner failure (lessons, defect 12).
 */
export function runnerFailure(collector: RunCollector, files: InstanceFiles): string | null {
  const errors = [
    ...[...collector.modules.values()].flatMap((m) => m.errors),
    ...collector.unhandledErrors,
  ];
  const error = errors.find((e) => isRunnerFailure(e, files));
  return error === undefined ? null : (errorText(error).split("\n")[0] ?? "");
}

/**
 * True for (1) an ENOENT naming a path under the instance's temp
 * directories: a transform copy deleted under a live instance; (2) an error
 * raised by Vite's module runner whose message and stack name no project
 * file: the loader could not read a file of the installation, as during
 * `npm ci`. A test file's own import error names the importing file, a
 * syntax error is raised by the transform, and a module that throws while
 * imported is the top frame: all three stay a `fail`.
 */
export function isRunnerFailure(error: SerializedError, files: InstanceFiles): boolean {
  const text = `${error.message ?? ""}\n${error.stack ?? ""}`;
  if (isMissingFile(error) && mentionedPaths(text).some((p) => underAny(p, files.tempDirs))) {
    return true;
  }
  const top = topFrame(error.stack ?? "");
  if (top === null || !isModuleRunner(top)) return false;
  return !mentionedPaths(text).some(
    (p) => files.paths.isProjectFile(p) && !underAny(p, files.tempDirs),
  );
}

function isMissingFile(error: SerializedError): boolean {
  return error.code === "ENOENT" || /^ENOENT\b/.test(error.message ?? "");
}

/** Vite's module runner, which fetches and evaluates every module a test file imports. */
function isModuleRunner(file: AbsolutePath): boolean {
  return file.split(sep).join("/").endsWith("/vite/dist/node/module-runner.js");
}

/** Absolute paths in `text`, `file://` URLs included, without a `:line:column` suffix. */
function mentionedPaths(text: string): AbsolutePath[] {
  const found = text.matchAll(/(?:file:\/\/)?(\/[^\s'"`()[\]]+)/g);
  return [...found].map((m) => (m[1] ?? "").replace(/(?::\d+)+$/, ""));
}

/** The file of the first `at` frame of a stack, or `null`. */
function topFrame(stack: string): AbsolutePath | null {
  const line = stack.split("\n").find((l) => /^\s*at\s/.test(l));
  return line === undefined ? null : (mentionedPaths(line)[0] ?? null);
}

function underAny(path: AbsolutePath, dirs: readonly AbsolutePath[]): boolean {
  return dirs.some((dir) => path === dir || path.startsWith(`${dir}${sep}`));
}
