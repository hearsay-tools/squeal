import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Review 0.1.658 B5: a Squeal CLI a test starts reads the user's
 * `remote.json` and `remote-machines.json` from `XDG_CONFIG_HOME` and
 * `XDG_STATE_HOME`, else from under HOME. Its daemon prunes the machines
 * of removed worktrees there at start, running their release hooks. So
 * every helper that starts the CLI with the real HOME also sets these
 * two to private directories: an absolute XDG path wins over HOME, and
 * the real user's remote files are never read or changed. HOME itself
 * stays, since it also selects Node (`node-pin.ts`) and tool caches.
 */

let dirs: { readonly XDG_CONFIG_HOME: string; readonly XDG_STATE_HOME: string } | null = null;

/** This test process's private config and state directories, made once, removed at its exit. */
export function testUserDirs(): {
  readonly XDG_CONFIG_HOME: string;
  readonly XDG_STATE_HOME: string;
} {
  if (dirs !== null) return dirs;
  const base = mkdtempSync(join(tmpdir(), "squeal-test-user-"));
  process.once("exit", () => rmSync(base, { recursive: true, force: true }));
  dirs = { XDG_CONFIG_HOME: join(base, "config"), XDG_STATE_HOME: join(base, "state") };
  return dirs;
}
