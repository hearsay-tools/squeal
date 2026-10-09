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
 * it, so `squeal why --include-logs` keeps a file's lines by their label
 * (`parseConsoleLine`). A label that could read as a shorter label plus text
 * (it holds `: `, a quote, a backslash or a control character) is written
 * as a JSON string (review wave-13i S2). A line Vitest tied to no requested
 * file has `[stdout]: `, which no tagged line starts with.
 */
export function consolePrefix(type: string, label: string | null): string {
  if (label === null) return `[${type}]: `;
  return `[${type}] ${quoted(label) ? JSON.stringify(label) : label}: `;
}

/** A `console` line of `vitest.log` read back: its stream, test file label and text. */
export interface ConsoleLine {
  readonly type: string;
  /** `null` for a line tied to no test file. */
  readonly label: string | null;
  readonly text: string;
}

/** The line `consolePrefix` began, or `null` for any other line of the log. */
export function parseConsoleLine(line: string): ConsoleLine | null {
  const head = /^\[(stdout|stderr)\](: | )/.exec(line);
  if (head === null) return null;
  const [prefix, type = "", separator] = head;
  const rest = line.slice(prefix.length);
  if (separator === ": ") return { type, label: null, text: rest };
  const label = rest.startsWith('"') ? jsonLabel(rest) : plainLabel(rest);
  return label === null ? null : { type, label: label.label, text: label.text };
}

/** Empty, holding `: `, or holding a character JSON escapes (a quote, a backslash, a control). */
function quoted(label: string): boolean {
  return label === "" || label.includes(": ") || JSON.stringify(label) !== `"${label}"`;
}

function plainLabel(rest: string): { label: string; text: string } | null {
  const end = rest.indexOf(": ");
  return end <= 0 ? null : { label: rest.slice(0, end), text: rest.slice(end + 2) };
}

/** The JSON string `rest` starts with, up to its closing quote, then `: `. */
function jsonLabel(rest: string): { label: string; text: string } | null {
  const end = /^"(?:[^"\\]|\\.)*": /.exec(rest);
  if (end === null) return null;
  try {
    const label: unknown = JSON.parse(end[0].slice(0, -2));
    return typeof label === "string" ? { label, text: rest.slice(end[0].length) } : null;
  } catch {
    return null;
  }
}
