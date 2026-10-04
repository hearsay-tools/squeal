import type { CheckId } from "../types/index.js";

/** Printed after the path of a file-level check. */
const FILE_LEVEL = " (file-level)";

/**
 * How a check is named in deltas, status and `squeal why`, in the shape
 * Vitest prints: `[project] path > describe > test`. The project prefix is
 * left out for the default project `""`. A file-level check is its path
 * followed by `(file-level)`.
 *
 * Spec 001 D6: "check names are printed and parsed by one shared formatter so
 * that a name an agent was told round-trips into `squeal why`."
 */
export function formatCheck(check: CheckId): string {
  const project = check.project === "" ? "" : `[${check.project}] `;
  return check.kind === "test"
    ? `${project}${check.testPath} > ${check.fullName}`
    : `${project}${check.testPath}${FILE_LEVEL}`;
}

/**
 * The check a name from `formatCheck` stands for. The path ends at the first
 * `" > "`; everything after it is the full name. A path alone, with or
 * without `(file-level)`, is the file-level check. `null` for an empty name.
 */
export function parseCheck(name: string): CheckId | null {
  const match = /^(?:\[([^\]]*)\] )?(.+)$/s.exec(name.trim());
  if (match === null) return null;
  const project = match[1] ?? "";
  const rest = match[2] ?? "";
  const split = rest.indexOf(" > ");
  if (split === -1) {
    const testPath = rest.endsWith(FILE_LEVEL) ? rest.slice(0, -FILE_LEVEL.length) : rest;
    return { kind: "file", project, testPath };
  }
  return {
    kind: "test",
    project,
    testPath: rest.slice(0, split),
    fullName: rest.slice(split + 3),
  };
}
