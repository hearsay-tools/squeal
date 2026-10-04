import type { CheckId } from "../types/index.js";

/**
 * How a check is named in human output and given to `squeal why`, in the
 * shape Vitest prints: `[project] path > describe > test`. The project
 * prefix is left out for the default project `""`. A file-level check is its
 * path alone.
 */
export function formatCheck(check: CheckId): string {
  const project = check.project === "" ? "" : `[${check.project}] `;
  return check.kind === "test"
    ? `${project}${check.testPath} > ${check.fullName}`
    : `${project}${check.testPath}`;
}

/**
 * The check a name from `formatCheck` stands for. The path ends at the first
 * `" > "`; everything after it is the full name. `null` for an empty name.
 */
export function parseCheck(name: string): CheckId | null {
  const match = /^(?:\[([^\]]*)\] )?(.+)$/s.exec(name.trim());
  if (match === null) return null;
  const project = match[1] ?? "";
  const rest = match[2] ?? "";
  const split = rest.indexOf(" > ");
  if (split === -1) return { kind: "file", project, testPath: rest };
  return {
    kind: "test",
    project,
    testPath: rest.slice(0, split),
    fullName: rest.slice(split + 3),
  };
}
