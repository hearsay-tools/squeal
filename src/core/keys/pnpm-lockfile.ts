/** pnpm's installed lockfile, relative to the directory that holds `node_modules`. */
export const PNPM_LOCKFILE = "node_modules/.pnpm/lock.yaml";

/**
 * Task 011-85, R3 (011 C11): pnpm's installed `lock.yaml` without the
 * `specifier` line of each dependency whose `version` is `link:`, the range
 * a release rewrites in every dependent of a linked workspace package. The
 * `version: link:` line stays, so a retargeted link still moves the
 * fingerprint, and so does every registry range. A text filter, not a
 * reading of the format: pnpm writes `specifier` right before `version` at
 * the same indent. Any other layout keeps every line, so the fingerprint
 * splits and never matches wrongly.
 */
export function withoutLinkedSpecifiers(text: string): string {
  const lines = text.split("\n");
  return lines.filter((line, at) => !linkedSpecifier(line, lines[at + 1] ?? "")).join("\n");
}

function linkedSpecifier(line: string, next: string): boolean {
  const indent = /^( +)specifier: /.exec(line)?.[1];
  return indent !== undefined && next.startsWith(`${indent}version: link:`);
}
