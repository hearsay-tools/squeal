import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach } from "vitest";
import { PLUGIN_DIST } from "../../src/harness/claude-code/build.js";

export interface BundleRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly ms: number;
}

/**
 * Where the bundles run from: the committed `dist`, or `SQUEAL_TEST_DIST`, so a
 * worker that may not rebuild `dist` can measure its change from bundles built
 * elsewhere (`bundleOptions(<dir>)`).
 */
const DIST = process.env.SQUEAL_TEST_DIST ?? PLUGIN_DIST;

/** Runs a hook bundle the way hooks.json does: `node --disable-warning=... <bundle>`, stdin piped. */
export function runBundle(
  name: string,
  stdin: string,
  env: Readonly<Record<string, string>> = {},
): Promise<BundleRun> {
  return runNode(
    ["--disable-warning=ExperimentalWarning", join(DIST, `${name}.mjs`)],
    stdin,
    env,
  );
}

/** Runs `node <args>` in `cwd` with a minimal environment plus `env`, stdin piped, timed. */
export function runNode(
  args: readonly string[],
  stdin: string,
  env: Readonly<Record<string, string>> = {},
  cwd?: string,
): Promise<BundleRun> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, args, {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      ...(cwd === undefined ? {} : { cwd }),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        ms: performance.now() - started,
      }),
    );
    child.stdin.end(stdin);
  });
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A short runtime dir for daemon sockets; socket paths are limited to 108 bytes. */
export function runtimeDir(): string {
  const dir = mkdtempSync("/tmp/sq-");
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A directory outside any git worktree. The test temp dir can sit inside a
 * checkout, so this one is made under /tmp.
 */
export function outsideGit(): string {
  return runtimeDir();
}

/** A unix socket that accepts connections, standing in for a live daemon. */
export function liveSocket(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => socket.end());
    cleanups.push(() => server.close());
    server.listen(path, () => resolve(server));
  });
}
