import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PartCheck, PartFile } from "../../core/ci/parts.js";
import { compare } from "../../core/fs/compare.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { CheckRunResult } from "../../core/types/runner.js";
import type { TestEvent } from "./run/events.js";
import type { ObservedClosure } from "./run/observed.js";

/*
 * Spec 018 D23.6, D24, D25 (row 018-47): one test file of a `node --test`
 * process's events, as a part holds it, and the Node build's hash.
 */

export function partFile(
  testFile: TestFileRef,
  results: readonly CheckRunResult[],
  fileError: boolean,
  durationMs: number | null,
  closure: ObservedClosure,
): PartFile {
  const checks: PartCheck[] = results.map((result) => ({
    fullName: result.check.kind === "test" ? result.check.fullName : "",
    outcome: result.outcome === "fail" ? "fail" : result.outcome === "skip" ? "skip" : "pass",
    durationMs: result.durationMs,
    location:
      result.location === null
        ? null
        : { line: result.location.line, column: result.location.column },
  }));
  const failed = fileError || checks.some((c) => c.outcome === "fail");
  const skipped = checks.length > 0 && checks.every((c) => c.outcome === "skip");
  const shared = sharedNames(checks);
  const { paths, direct, written } = closure;
  return {
    ...testFile,
    outcome: failed ? "fail" : skipped ? "skip" : "pass",
    durationMs,
    checks,
    observed: {
      paths,
      directories: [],
      ...(direct.length > 0 ? { direct } : {}),
      ...(written.length > 0 ? { written } : {}),
    },
    ...(shared.length > 0 ? { sharedNames: shared } : {}),
  };
}

/** Full names two checks still share after `identify` named repeats by their line: no line to tell them. */
export function sharedNames(checks: readonly PartCheck[]): string[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const { fullName } of checks) {
    if (seen.has(fullName)) shared.add(fullName);
    seen.add(fullName);
  }
  return [...shared].sort(compare);
}

/**
 * Each test file's events, by the absolute file they name: Node names every
 * event of a file's process by its path, absolute, but a `test:stderr` on
 * Node 22 relative to the working directory.
 */
export function eventsByFile(
  events: readonly TestEvent[],
  cwd: AbsolutePath,
): Map<AbsolutePath, TestEvent[]> {
  const byFile = new Map<AbsolutePath, TestEvent[]>();
  for (const event of events) {
    const file = event.data.file;
    if (typeof file !== "string" || file === "") continue;
    const absolute = isAbsolute(file) ? file : resolve(cwd, file);
    const list = byFile.get(absolute) ?? [];
    list.push(event);
    byFile.set(absolute, list);
  }
  return byFile;
}

/** The name Node gave the file's own test: its path as the command gave it, which resolves to the file. */
export function wrapperName(
  events: readonly TestEvent[],
  absolute: AbsolutePath,
  cwd: AbsolutePath,
): string {
  const wrapper = events.find(
    (e) =>
      e.type === "test:complete" &&
      e.data.nesting === 0 &&
      e.data.entryFile === undefined &&
      typeof e.data.name === "string" &&
      resolve(cwd, e.data.name) === absolute,
  );
  return wrapper?.data.name ?? relative(cwd, absolute).split(sep).join("/");
}

export function finalSummary(events: readonly TestEvent[]): TestEvent[] {
  return events.filter((e) => e.type === "test:summary" && e.data.file === null);
}

/** The hash of Node's build fields, as `probeNode` hashes its probe's line: sorted keys, sha256. */
export function nodeBuildOf(build: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sorted(build)))
    .digest("hex");
}

function sorted(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sorted);
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, sorted(object[key])]),
  );
}
