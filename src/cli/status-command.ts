import { fileURLToPath } from "node:url";
import { SQUEAL_COMMAND } from "../core/delivery/index.js";
import { codexCommand } from "../harness/codex/command.js";

/**
 * How status text names the CLI (lessons, defect 27): in a Codex shell
 * (`CODEX_SESSION_ID` set, spec 002 D6) `squeal` is not on the PATH, so the
 * Codex command its hooks name (spec 002 D1 as amended), with this bundle as
 * the CLI; `squeal` otherwise. `cli` is for tests: bundled, this module is
 * `dist/cli/squeal.mjs`.
 */
export function statusCommand(
  env: Readonly<Record<string, string | undefined>>,
  cli: string = fileURLToPath(import.meta.url),
): string {
  const session = env.CODEX_SESSION_ID;
  return session === undefined || session === "" ? SQUEAL_COMMAND : codexCommand(env, cli);
}
