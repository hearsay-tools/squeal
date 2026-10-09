import type { ProjectName, RelativePath } from "./types/index.js";

/** The file a Vitest run writes under its `runs/<run-id>/` directory. */
export const VITEST_LOG = "vitest.log";

/** A test file as `vitest.log` names it: `[project] path`, or the path alone. */
export function testFileLabel(project: ProjectName, path: RelativePath): string {
  return project ? `[${project}] ${path}` : path;
}

/**
 * The prefix of a `console` line in `vitest.log` that the reporter tied to a
 * test file: `[stdout] test/a.test.ts: `. Every line of the output carries
 * it, so `squeal why --include-logs` keeps a file's lines by prefix alone.
 * A line Vitest tied to no requested file keeps the bare `[stdout] `.
 */
export function consolePrefix(type: string, label: string | null): string {
  return label === null ? `[${type}] ` : `[${type}] ${label}: `;
}
