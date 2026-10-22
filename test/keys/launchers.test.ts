import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./validity/trees.js";

/*
 * The plugins' launchers are left out of the alarm (task 011-37 section 2 as
 * decided for row 011-41, 2026-10-20): the Node that runs is in every
 * environment hash (`nodeVersion`), the CLI a launcher picks carries its own
 * `KEY_FORMAT_VERSION`, and `--disable-warning` stores nothing. That holds
 * while a launcher runs Node with no other flag and no environment of its
 * own; a launcher that adds either fails here and goes to the coordinator,
 * instead of silently changing how the daemon runs.
 */

const LAUNCHERS = readdirSync(join(ROOT, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((plugin) => {
    const bin = join(ROOT, "plugins", plugin.name, "bin");
    const names = readdirSync(join(ROOT, "plugins", plugin.name)).includes("bin")
      ? readdirSync(bin)
      : [];
    return names.map((name) => `plugins/${plugin.name}/bin/${name}`);
  });

/**
 * The shell lines of `text`, comments dropped, the `node -e` script's body
 * left out. No `'` can stand inside it, so its first line that starts with one ends it.
 */
function shellLines(text: string): string[] {
  const lines: string[] = [];
  let inScript = false;
  for (const line of text.split("\n")) {
    if (inScript) {
      if (line.startsWith("'")) inScript = false;
      continue;
    }
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    if (/\bnode\b.*\s-e '$/.test(line)) inScript = true;
    lines.push(line);
  }
  return lines;
}

/** `exec node <flags> "<cli>"`, or `exec node <flags> -e '<lookup>` from format 6. */
const EXEC_NODE = /\bexec node((?:\s+-\S+)*)\s+(?:"|-e '$)/;

describe("the launchers", () => {
  it("are found", () => {
    expect(LAUNCHERS).toContain("plugins/claude-code/bin/squeal");
    expect(LAUNCHERS.length).toBeGreaterThan(3);
  });

  it.each(LAUNCHERS)("%s runs Node with --disable-warning flags only", (path) => {
    const lines = shellLines(readFileSync(join(ROOT, path), "utf8"));
    const runs = lines.filter((line) => /(?:^\s*(?:exec\s+)?|\$\()node\s/.test(line));
    expect(runs.length, path).toBeGreaterThan(0);
    for (const line of runs) {
      // The CLI's lookup is a script Node runs with `-e`. Up to format 5 the launcher read its
      // output; from format 6 (005-75) it imports the CLI and drops `-e` from `process.execArgv`.
      if (/^\S+=\$\(node -e '$/.test(line.trim())) continue;
      const flags = EXEC_NODE.exec(line)?.[1]?.split(/\s+/).filter(Boolean) ?? null;
      expect(flags, `${path}: ${line}`).not.toBeNull();
      for (const flag of flags ?? []) expect(flag, path).toMatch(/^--disable-warning=\w+$/);
    }
  });

  it.each(LAUNCHERS)("%s sets no environment for the process it runs", (path) => {
    const text = readFileSync(join(ROOT, path), "utf8");
    expect(text, path).not.toMatch(/NODE_OPTIONS/);
    for (const line of shellLines(text)) {
      expect(line, path).not.toMatch(/^\s*(?:export|declare\s+-x|env)\s/);
      expect(line, path).not.toMatch(/^\s*(?:exec\s+)?[A-Za-z_]\w*=\S*\s+(?:exec\s+)?node\b/);
    }
  });
});
