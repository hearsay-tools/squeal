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
 *
 * Spec 025 D7, by agreement with the coordinator (row 025-07): a launcher may
 * also export Node's compile cache with Squeal's mark, which stores only V8
 * code keyed by its source and which test runners take out again, and may
 * carry NODE_USE_ENV_PROXY past Node's start with the one guarded preload
 * that puts it back. Nothing else.
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

/**
 * `exec node <flags> "<cli>"`, or `exec node <flags> -e '<lookup>` from format
 * 6; from spec 025 D7 `set -- node <flags> ...`, run by `exec "$@"`.
 */
const EXEC_NODE = /\b(?:exec|set --) node((?:\s+(?:--import "[^"]*"|-\S+))*)\s+(?:"|-e '$)/;
/** The one preload a launcher may add (spec 025 D7). */
const RESTORE_PRELOAD = `--import "data:text/javascript,if(process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY!==undefined){process.env.NODE_USE_ENV_PROXY=process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY;Reflect.deleteProperty(process.env,'SQUEAL_CARRIED_NODE_USE_ENV_PROXY')}"`;
/** The variables a launcher may export (spec 025 D7). */
const EXPORTED = new Set([
  "NODE_COMPILE_CACHE",
  "SQUEAL_OWN_COMPILE_CACHE",
  "SQUEAL_CARRIED_NODE_USE_ENV_PROXY",
]);

describe("the launchers", () => {
  it("are found", () => {
    expect(LAUNCHERS).toContain("plugins/claude-code/bin/squeal");
    expect(LAUNCHERS.length).toBeGreaterThan(3);
  });

  it.each(LAUNCHERS)("%s runs Node with --disable-warning flags only", (path) => {
    const lines = shellLines(readFileSync(join(ROOT, path), "utf8"));
    const runs = lines.filter((line) => /(?:^\s*(?:exec\s+|set\s+--\s+)?|\$\()node\s/.test(line));
    expect(runs.length, path).toBeGreaterThan(0);
    for (const line of runs) {
      // The CLI's lookup is a script Node runs with `-e`. Up to format 5 the launcher read its
      // output; from format 6 (005-75) it imports the CLI and drops `-e` from `process.execArgv`.
      if (/^\S+=\$\(node -e '$/.test(line.trim())) continue;
      const matched = EXEC_NODE.exec(line)?.[1] ?? null;
      expect(matched, `${path}: ${line}`).not.toBeNull();
      const flags = (matched ?? "").split(RESTORE_PRELOAD).join(" ").split(/\s+/).filter(Boolean);
      for (const flag of flags) expect(flag, path).toMatch(/^--disable-warning=\w+$/);
    }
  });

  it.each(LAUNCHERS)("%s sets no environment for the process it runs", (path) => {
    const text = readFileSync(join(ROOT, path), "utf8");
    expect(text, path).not.toMatch(/NODE_OPTIONS/);
    for (const line of shellLines(text)) {
      const exported = /^\s*export\s+([A-Za-z_]\w*(?:\s+[A-Za-z_]\w*)*)\s*$/.exec(line)?.[1];
      if (exported?.split(/\s+/).every((name) => EXPORTED.has(name))) continue;
      expect(line, path).not.toMatch(/^\s*(?:export|declare\s+-x|env)\s/);
      expect(line, path).not.toMatch(/^\s*(?:exec\s+)?[A-Za-z_]\w*=\S*\s+(?:exec\s+)?node\b/);
    }
  });
});
