import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/harness/build.js";

/*
 * Row 002-31 (spec 002 D7): the least a fixed plugin needs to be found and
 * named in a launcher config: its manifest, the committed `hooks/hooks.json`
 * and a `seed/`. With `reporting`, each `dist/<hook>.mjs` prints the hook's
 * name and the `PLUGIN_ROOT` and `PLUGIN_DATA` it ran with.
 */

export const ADAPTER = "1.0.0";

export function fixedPluginAt(root: string, reporting = false): string {
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({ name: "squeal", version: ADAPTER })}\n`,
  );
  cpSync(join(REPO_ROOT, "plugins/codex/hooks"), join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, "seed"), { recursive: true });
  writeFileSync(join(root, "seed", "runtime.json"), "{}\n");
  if (reporting) {
    mkdirSync(join(root, "dist"), { recursive: true });
    for (const hook of [
      "session-start",
      "user-prompt-submit",
      "pre-tool-use",
      "post-tool-use",
      "stop",
      "stop-slow",
      "subagent-start",
      "subagent-stop",
      "interrupt",
      "session-end",
    ]) {
      writeFileSync(
        join(root, "dist", `${hook}.mjs`),
        `process.stdout.write(JSON.stringify({ hook: ${JSON.stringify(hook)}, root: process.env.PLUGIN_ROOT, data: process.env.PLUGIN_DATA }));\n`,
      );
    }
  }
  return root;
}
