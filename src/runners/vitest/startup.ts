import type { SerializedError, TestSpecification, Vitest } from "vitest/node";
import { compare } from "../../core/fs/index.js";
import { causeText, withCode } from "../../core/state/fingerprint.js";
import type {
  AbsolutePath,
  CheckError,
  RunReport,
  StartupFailure,
} from "../../core/types/index.js";
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
 * file reported, or `null` when one did: Vitest reports a failed start as
 * one error and runs nothing, as `vitest run` does.
 */
export function startupFailure(
  vitest: Vitest,
  specs: readonly TestSpecification[],
  collector: RunCollector,
  error: unknown,
  paths: WorktreePaths,
): StartupFailure | null {
  if (collector.modules.size > 0 || collector.results.length > 0) return null;
  const text = errorTexts(error);
  const named = vitest.projects.flatMap((project) =>
    setupFiles(project.config.globalSetup)
      .filter((file) => text.includes(file))
      .map((file) => ({ project: project.name, file })),
  )[0];
  const projects = named
    ? [named.project]
    : [...new Set(specs.map((spec) => spec.project.name))].sort(compare);
  const setupFile = named ? paths.toRelative(named.file) : null;
  const checkError = toCheckError(error as SerializedError, paths);
  const location = named ? frameOf(text, named.file, paths) : null;
  return {
    projects,
    testFiles: [...collector.requested],
    setupFile,
    error: { ...checkError, location: location ?? checkError.location, phase: "setup" },
  };
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

/** Closes the instance of a run that rejected; the caller starts a new one on its next call. */
export async function closeRejected(vitest: Vitest, collector: RunCollector): Promise<void> {
  await vitest
    .close()
    .catch((error: unknown) =>
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
