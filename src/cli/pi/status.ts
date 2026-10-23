import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { worktreeIdFor } from "../../core/fs/index.js";
import { withStatusStore } from "../../core/status/index.js";
import { shellWord } from "../../core/text.js";
import type { AbsolutePath } from "../../core/types/index.js";

/*
 * Spec 009 D7: a Pi package puts nothing on the PATH and its extension runs
 * inside Pi, so `squeal status` in a Pi shell is where a user learns that
 * Squeal is quiet because the extension is not there. The shell sees the
 * session id as `PI_SESSION_ID`, the extension registers it (D2).
 */

/** The README's install command, for a CLI that is not the Pi package's own. */
export const INSTALL_SH_COMMAND =
  "curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh";

/**
 * How Pi texts name the CLI `cli` (D7), as the extension's `piCommand` does:
 * the Node running it and the CLI, both by absolute path, quoted for a shell.
 */
export function piCliCommand(cli: string, node: string = process.execPath): string {
  return `${shellWord(node)} --disable-warning=ExperimentalWarning ${shellWord(cli)}`;
}

/**
 * The command that installs Squeal in Pi: `pi install` of the package this
 * CLI is part of (`<package>/dist/cli/squeal.mjs`), or `install.sh` when this
 * CLI is a Claude Code or Codex plugin's.
 */
export function piInstallCommand(cli: string): string {
  const root = dirname(dirname(dirname(cli)));
  try {
    const manifest = join(root, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "squeal-pi") {
      return `pi install ${shellWord(root)}`;
    }
  } catch {
    // An unreadable manifest is not the Pi package.
  }
  return INSTALL_SH_COMMAND;
}

/**
 * The line `squeal status` adds when `PI_SESSION_ID` is set and no consumer of
 * that session is registered in this worktree, or no store exists; `null`
 * otherwise, including when the store cannot be read. As the Codex line (002
 * review wave 1, S1), it states what is known: the extension may have started
 * before the store existed and registers at the session's next tool call.
 */
export function piStatusLine(
  cwd: AbsolutePath,
  env: Readonly<Record<string, string | undefined>>,
  cli: string,
): string | null {
  const session = env.PI_SESSION_ID;
  if (session === undefined || session === "") return null;
  const registered = withStatusStore(cwd, {}, ({ store, root }) =>
    store.consumers.list(worktreeIdFor(root)).some((c) => c.consumer.sessionId === session),
  );
  if (registered === true) return null;
  if (registered !== false && registered.reason !== "no-store") return null;
  return (
    `Pi: no Squeal consumer is registered for this session in this worktree (PI_SESSION_ID ${session}). ` +
    "Either the Squeal Pi extension is not loaded in it, or it has not registered the session yet: " +
    "a session that started before the store existed registers at its next tool call. " +
    `Without the extension, install it with ${piInstallCommand(cli)}, then start Pi again.\n`
  );
}
