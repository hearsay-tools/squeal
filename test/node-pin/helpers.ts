import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../store/helpers.js";

/*
 * Spec 018 D18 (row 018-30): fake installed Node trees under a temporary
 * HOME, never the real one. A fake `node` is a shell script that answers
 * `--version` with its version and records any other start.
 */

/** Every directory variable a version manager reads, so a test sees only its fake HOME. */
const MANAGER_VARIABLES = [
  "NVM_DIR",
  "FNM_DIR",
  "VOLTA_HOME",
  "ASDF_DATA_DIR",
  "MISE_DATA_DIR",
  "XDG_DATA_HOME",
  "N_PREFIX",
] as const;

export interface FakeHome {
  readonly home: string;
  /** An environment that points every version manager into `home`, with `path` as `PATH`. */
  readonly env: NodeJS.ProcessEnv;
}

/** A temporary HOME, and an environment where no version manager reads outside it. */
export function fakeHome(path: string = tempDir("squeal-node-pin-bin-")): FakeHome {
  const home = realpathSync(tempDir("squeal-node-pin-home-"));
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: path, N_PREFIX: join(home, "n-prefix") };
  return { home, env };
}

/** `env` with every version manager variable but those `env` sets removed from `base`. */
export function withoutManagers(base: NodeJS.ProcessEnv, env: NodeJS.ProcessEnv) {
  const next: NodeJS.ProcessEnv = { ...base };
  for (const name of MANAGER_VARIABLES) delete next[name];
  return { ...next, ...env };
}

/**
 * A fake `node` at `path` that prints `v<version>` for `--version`; any
 * other start writes its `$0`, `PATH` and arguments, one per line, to
 * `record` when given. `count` gets one line per `--version`.
 */
export function fakeNode(
  path: string,
  version: string,
  options: { readonly record?: string; readonly count?: string } = {},
): string {
  mkdirSync(dirname(path), { recursive: true });
  const count = options.count === undefined ? "" : `echo x >> '${options.count}'; `;
  const record =
    options.record === undefined
      ? "exit 0"
      : `{ echo "$0"; echo "$PATH"; for a in "$@"; do echo "$a"; done; } > '${options.record}.tmp' && mv '${options.record}.tmp' '${options.record}'`;
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then ${count}echo v${version}; exit 0; fi\n${record}\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

/** The nvm binary of `version` under `home`, as nvm installs it. */
export function nvmNode(home: string, version: string): string {
  return join(home, ".nvm", "versions", "node", `v${version}`, "bin", "node");
}

/** A worktree root with `files` written into it. */
export function rootWith(files: Readonly<Record<string, string>>): string {
  const root = realpathSync(tempDir("squeal-node-pin-root-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}
