#!/usr/bin/env node
// Throwaway probe for 015-10 Part C (copied from 007-18's as-e2e.mjs, unchanged but for this header,
// COREPACK_HOME and the pnpm store under the case root). Not product code.
//
// Runs one command as the throwaway OS user squeal-e2e by 005-17's contract (the command line and
// guard of test/real-cli/isolated.ts):
//
//   node as-e2e.mjs <case root> <cwd> <cmd> [args...]
//
//   sudo -n [--preserve-env=<names>] -u squeal-e2e -H env [-i] HOME=… PATH=… <scratch vars>
//     /bin/sh -c 'mkdir -p "$1" && cd "$1" || exit 125; shift; exec "$@"' sh <cwd> <cmd> …
//
// The case root must be /home/squeal-e2e/runs/<id>, and cwd lies under it. HOME, TMPDIR,
// CODEX_HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR, SQ_EVALS_ROOT and uv's cache and Python
// directories are under it.
// Credentials pass by name only (E2E_PRESERVE, comma-separated), never in argv: sudo is spawned
// from cwd / with an environment of PATH and those names alone, and with none `env -i` is the
// clean start. E2E_NODE picks the subject's Node (22 or 24, default 24). stdio is inherited;
// the caller redacts what it keeps. Exit status is the command's.

import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { posix } from "node:path";

const [root0, cwd0, cmd, ...args] = process.argv.slice(2);
const refuse = (why) => {
  console.error(`refused: ${why}`);
  process.exit(2);
};
if (!root0 || !cwd0 || !cmd) refuse("usage: as-e2e.mjs <case root> <cwd> <cmd> [args...]");
if (userInfo().username === "squeal-e2e") refuse("run this as agent, not squeal-e2e");
const root = posix.normalize(root0);
const cwd = posix.normalize(cwd0);
if (!/^\/home\/squeal-e2e\/runs\/[a-z0-9-]+$/.test(root)) refuse(`case root ${root0}`);
if (cwd !== root && !cwd.startsWith(`${root}/`)) refuse(`cwd ${cwd0} is outside ${root}`);
const node = process.env.E2E_NODE ?? "24";
if (node !== "22" && node !== "24") refuse(`E2E_NODE=${node}`);
const preserve = (process.env.E2E_PRESERVE ?? "").split(",").filter(Boolean);
for (const name of preserve) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) refuse(`preserve name ${name}`);

const vars = {
  HOME: `${root}/home`,
  TMPDIR: `${root}/tmp`,
  CODEX_HOME: `${root}/codex`,
  CLAUDE_CONFIG_DIR: `${root}/claude`,
  XDG_RUNTIME_DIR: `${root}/xdg`,
  SQ_EVALS_ROOT: `${root}/evals`,
  UV_CACHE_DIR: `${root}/uv/cache`,
  UV_PYTHON_INSTALL_DIR: `${root}/uv/python`,
  UV_TOOL_DIR: `${root}/uv/tools`,
  UV_NO_MODIFY_PATH: "1",
  COREPACK_HOME: `${root}/corepack`,
  npm_config_store_dir: `${root}/pnpm-store`,
  DISABLE_AUTOUPDATER: "1",
  LANG: "C.UTF-8",
  PATH: `${root}/bin:/opt/squeal-e2e/node${node}/bin:/usr/bin:/bin`,
};
for (const [k, v] of Object.entries(process.env))
  if (k.startsWith("E2E_VAR_")) {
    const name = k.slice("E2E_VAR_".length);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /KEY|TOKEN|SECRET|PASSWORD|AUTH/.test(name))
      refuse(`extra variable ${name}`);
    if (/[\n\0]/.test(v)) refuse(`${name} holds a newline`);
    vars[name] = v;
  }

const line = [
  "-n",
  ...(preserve.length ? [`--preserve-env=${preserve.join(",")}`] : []),
  "-u",
  "squeal-e2e",
  "-H",
  "env",
  ...(preserve.length ? [] : ["-i"]),
  ...Object.entries(vars).map(([k, v]) => `${k}=${v}`),
  "/bin/sh",
  "-c",
  'mkdir -p "$1" && cd "$1" || exit 125; shift; exec "$@"',
  "sh",
  cwd,
  cmd,
  ...args,
];
const parentEnv = { PATH: "/usr/bin:/bin" };
for (const name of preserve) if (process.env[name] !== undefined) parentEnv[name] = process.env[name];
const child = spawn("sudo", line, { cwd: "/", env: parentEnv, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
