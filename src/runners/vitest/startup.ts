import type { SerializedError, TestProject, TestSpecification, Vitest } from "vitest/node";
import { compare } from "../../core/fs/index.js";
import { causeText, withCode } from "../../core/state/fingerprint.js";
import type {
  AbsolutePath,
  CheckError,
  ProjectName,
  RunReport,
  StartupFailure,
} from "../../core/types/index.js";
import { closeEmptied } from "./empty-closed.js";
import type { WorktreePaths } from "./paths.js";
import type { RunCollector } from "./reporter.js";
import { toCheckError } from "./results.js";

/*
 * Task 001-382, research cezar-e2e-setup (d): Vitest sets a project's
 * `_globalSetups` before it calls them, so after a `globalSetup` throws the
 * same instance skips the setup on every later run, and its files run with
 * no setup at all. A run that rejects therefore closes its instance, and the
 * next run starts a new one that runs the setup again.
 */

/**
 * The startup failure of a run that rejected with `error` before any test
 * file was queued, or `null` when one was: Vitest reports a failed start as
 * one error and runs nothing, as `vitest run` does. Never throws, so the
 * caller closes the instance whatever the error is (review wave-13bp B2).
 */
export function startupFailure(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  collector: RunCollector,
  error: unknown,
  paths: WorktreePaths,
): StartupFailure | null {
  if (collector.queued > 0 || collector.modules.size > 0 || collector.results.length > 0) {
    return null;
  }
  try {
    return classify(vitest, specs, collector, thrown(error), paths);
  } catch (failure) {
    collector.note(`reading the error of a run that failed to start failed: ${String(failure)}`);
    return null;
  }
}

function classify(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  collector: RunCollector,
  error: SerializedError,
  paths: WorktreePaths,
): StartupFailure {
  const text = errorTexts(error);
  const owner = setupOwner(vitest, specs, text);
  const checkError = toCheckError(error, paths);
  const location = owner ? frameOf(text, owner.file, paths) : null;
  return {
    projects: owner?.projects ?? runProjects(specs),
    testFiles: [...collector.requested],
    setupFile: owner ? paths.toRelative(owner.file) : null,
    error: { ...checkError, location: location ?? checkError.location, phase: "setup" },
  };
}

/**
 * The setup file the error names and the run's projects it fails, or `null`
 * when it names none or several (review wave-13bp B3). Only the run's
 * projects run their setups, with the root project's, which Vitest
 * initializes for every run: a file of the root project's setup fails every
 * project of the run, and a file shared by run projects fails each of them.
 */
function setupOwner(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  text: string,
): { readonly projects: ProjectName[]; readonly file: AbsolutePath } | null {
  const named = (project: TestProject) =>
    setupFiles(project.config.globalSetup).filter((file) => text.includes(file));
  const run = [...new Set(specs.map((spec) => spec.project))];
  const root = vitest.getRootProject();
  const owners = run.flatMap((project) => named(project).map((file) => ({ project, file })));
  const rootFiles = run.includes(root) ? [] : named(root);
  const files = new Set([...owners.map((o) => o.file), ...rootFiles]);
  const [file] = files;
  if (file === undefined || files.size > 1) return null;
  if (rootFiles.length > 0) return { projects: runProjects(specs), file };
  return { projects: [...new Set(owners.map((o) => o.project.name))].sort(compare), file };
}

function runProjects(specs: readonly TestSpecification[]): ProjectName[] {
  return [...new Set(specs.map((spec) => spec.project.name))].sort(compare);
}

/** `error` as Vitest serializes one; a thrown `null`, `undefined` or primitive keeps its text. */
function thrown(error: unknown): SerializedError {
  if (typeof error === "object" && error !== null) return error as SerializedError;
  const message =
    typeof error === "string" ? error : `the run rejected with ${String(error)}, not an Error`;
  return { name: "Error", message, stack: "" } as SerializedError;
}

/**
 * `report` with its startup failure; the run's failure line becomes the
 * error's message, code and causes, which the run log's stack lacks
 * (research cezar-e2e-setup (c)).
 */
export function withStartup(report: RunReport, startup: StartupFailure | null): RunReport {
  if (startup === null) return report;
  const { message, code, causes = [] } = startup.error;
  const chain = causes.map((cause) => `; cause: ${causeText(cause)}`).join("");
  const where =
    startup.setupFile === null
      ? "the run failed to start"
      : `global setup ${startup.setupFile} failed`;
  const failure = `${where}: ${withCode(message.split("\n")[0] ?? "", code)}${chain}`;
  return { ...report, failure, startupFailure: startup };
}

/**
 * Closes the instance of a run that rejected, and empties it once closed (task
 * 013-06); the caller starts a new one on its next call.
 */
export async function closeRejected(vitest: Vitest, collector: RunCollector): Promise<void> {
  await closeEmptied(vitest).catch((error: unknown) =>
    collector.note(`close() of an instance whose run rejected failed: ${String(error)}`),
  );
}

/** `config.globalSetup`, which Vitest resolves to absolute paths. */
function setupFiles(globalSetup: unknown): AbsolutePath[] {
  const files = Array.isArray(globalSetup) ? globalSetup : [globalSetup];
  return files.filter((file): file is string => typeof file === "string" && file !== "");
}

/** Message and stack of `error` and of each cause, where a setup file's frame can show. */
function errorTexts(error: unknown): string {
  const texts: string[] = [];
  for (let link = error, depth = 0; link != null && depth < 4; depth++) {
    if (typeof link !== "object") break;
    const { message, stack } = link as { message?: unknown; stack?: unknown };
    texts.push(String(message ?? ""), String(stack ?? ""));
    link = "cause" in link ? link.cause : undefined;
  }
  return texts.join("\n");
}

/** The first stack frame in `file`, as a location. */
function frameOf(text: string, file: AbsolutePath, paths: WorktreePaths): CheckError["location"] {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:file://)?${escaped}:(\\d+):(\\d+)`).exec(text);
  return match ? paths.location(file, Number(match[1]), Number(match[2])) : null;
}
