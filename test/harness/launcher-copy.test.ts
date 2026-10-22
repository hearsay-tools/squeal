import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyPluginTrees,
  LAUNCHER_COPY,
  LAUNCHER_SOURCE,
  type PluginBuild,
  REPO_ROOT,
} from "../../src/harness/build.js";
import { CLAUDE_CODE_PLUGIN } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN } from "../../src/harness/codex/build.js";
import { OPENCODE_PLUGIN } from "../../src/harness/opencode/build.js";
import { PI_PLUGIN } from "../../src/harness/pi/build.js";
import { tempDir } from "../store/helpers.js";

/*
 * 005-76: `plugins/claude-code/bin/squeal-launcher` is the launcher's one
 * source; the Codex, Pi and OpenCode builds copy it into their `bin/`, so a
 * launcher change edits one file. CI's `Bundles match the build` diff covers
 * each plugin's `bin/`, so a hand edit to a copy fails there.
 */

const COPIED: [string, PluginBuild][] = [
  ["codex", CODEX_PLUGIN],
  ["pi", PI_PLUGIN],
  ["opencode", OPENCODE_PLUGIN],
];

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("the launcher's one source (005-76)", () => {
  it("is the Claude Code plugin's own launcher, which its build copies nowhere", () => {
    expect(join(REPO_ROOT, LAUNCHER_SOURCE)).toBe(
      join(CLAUDE_CODE_PLUGIN.pluginDir, LAUNCHER_COPY.to),
    );
    // `buildPlugin` removes a copy's target first: an entry here would delete the source.
    expect((CLAUDE_CODE_PLUGIN.copies ?? []).map((c) => c.to)).not.toContain(LAUNCHER_COPY.to);
  });

  it.each(COPIED)("is copied by the %s build", (_, plugin) => {
    expect(plugin.copies).toContainEqual(LAUNCHER_COPY);
  });

  it.each(COPIED)(
    "after an edit to the source alone, the %s copy step writes its bytes, mode 0755, over a hand-edited copy",
    (_, plugin) => {
      const root = tempDir("squeal-launcher-root-");
      const source = join(root, LAUNCHER_SOURCE);
      mkdirSync(dirname(source), { recursive: true });
      const edited = `${readFileSync(join(REPO_ROOT, LAUNCHER_SOURCE), "utf8")}# edited\n`;
      writeFileSync(source, edited);
      chmodSync(source, 0o755);
      const pluginDir = tempDir("squeal-launcher-plugin-");
      const copy = join(pluginDir, LAUNCHER_COPY.to);
      mkdirSync(dirname(copy), { recursive: true });
      writeFileSync(copy, "#!/bin/sh\necho hand-edited\n");
      chmodSync(copy, 0o644);

      const launcherOnly = (plugin.copies ?? []).filter((c) => c.from === LAUNCHER_SOURCE);
      copyPluginTrees({ ...plugin, pluginDir, copies: launcherOnly }, root);

      expect(readFileSync(copy, "utf8")).toBe(edited);
      expect(modeOf(copy)).toBe(0o755);
    },
  );

  it("is in both of CI's `Bundles match the build` diffs, so a hand edit to a copy fails CI", () => {
    const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const runs = [
      ...ci.matchAll(/- name: Bundles match the build\n(?: {8}.*\n)*? {8}run: (.*)\n/g),
    ];
    expect(runs.map((r) => r[1])).toEqual([
      expect.stringMatching(/^git diff --exit-code -- .* plugins\/\*\/bin$/),
      expect.stringMatching(/^git diff --exit-code -- .* plugins\/\*\/bin$/),
    ]);
  });

  it.each(COPIED)(
    "is written by the %s copy step as the committed source, mode kept",
    (_, plugin) => {
      const pluginDir = tempDir("squeal-launcher-plugin-");
      copyPluginTrees({ ...plugin, pluginDir });
      const copy = join(pluginDir, LAUNCHER_COPY.to);
      const source = join(REPO_ROOT, LAUNCHER_SOURCE);
      expect(readFileSync(copy, "utf8")).toBe(readFileSync(source, "utf8"));
      expect(modeOf(copy)).toBe(modeOf(source));
      expect(modeOf(copy) & 0o111).toBe(0o111);
    },
  );
});
