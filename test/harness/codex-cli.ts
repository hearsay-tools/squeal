import { codexCommand } from "../../src/harness/codex/command.js";

/** How the Codex hooks name the CLI of a plugin at a cache path: by its path, never `squeal`. */
export const CODEX = codexCommand(
  { PLUGIN_ROOT: "/srv/codex/.codex/plugins/cache/squeal/squeal/0.1.107" },
  "/unused.mjs",
);
