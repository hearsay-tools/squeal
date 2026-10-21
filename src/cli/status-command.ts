import { fileURLToPath } from "node:url";
import { SQUEAL_COMMAND } from "../core/delivery/index.js";
import { codexCommand } from "../harness/codex/command.js";
import { opencodeCliCommand } from "./opencode/status.js";
import { piCliCommand } from "./pi/status.js";

/**
 * How status text names the CLI (lessons, defect 27): in a Codex shell
 * (`CODEX_SESSION_ID` set, spec 002 D6) `squeal` is not on the PATH, so the
 * Codex command its hooks name (spec 002 D1 as amended), with this bundle as
 * the CLI: the launcher beside it when this bundle is Squeal's copy of its
 * version in the plugin data directory, which the launcher runs (spec 005 D3
 * as amended 2026-10-21); in a Pi shell (`PI_SESSION_ID` set, spec 009 D7) the Pi command,
 * this Node and this bundle by absolute path, and in an OpenCode shell the
 * plugin ran in (`OPENCODE_SESSION_ID` set, spec 008 D7) the same; `squeal`
 * otherwise. `cli` is for
 * tests: bundled, this module is `dist/cli/squeal.mjs`.
 */
export function statusCommand(
  env: Readonly<Record<string, string | undefined>>,
  cli: string = fileURLToPath(import.meta.url),
): string {
  if (env.CODEX_SESSION_ID !== undefined && env.CODEX_SESSION_ID !== "") {
    return codexCommand(env, cli);
  }
  if (env.PI_SESSION_ID !== undefined && env.PI_SESSION_ID !== "") return piCliCommand(cli);
  if (env.OPENCODE_SESSION_ID !== undefined && env.OPENCODE_SESSION_ID !== "") {
    return opencodeCliCommand(cli);
  }
  return SQUEAL_COMMAND;
}
