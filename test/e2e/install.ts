import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";

/*
 * The fixture repository's own `npm install` of Vitest, done once per machine
 * and copied into every fixture. Kept under /tmp between runs on purpose: it
 * is a cache, keyed by Vitest version, Node major and platform. Concurrent
 * test files race to install; the first rename wins and the others discard
 * their copy.
 */

/** The Vitest the fixture installs: the repository's own, so the npm cache has it offline. */
export const VITEST_VERSION = (
  JSON.parse(readFileSync(join(REPO_ROOT, "node_modules/vitest/package.json"), "utf8")) as {
    version: string;
  }
).version;

const CACHE_ROOT = "/tmp/squeal-e2e-cache";
const KEY = `vitest-${VITEST_VERSION}-node${process.versions.node.split(".")[0]}-${process.platform}-${process.arch}`;
const INSTALL_TIMEOUT_MS = 180_000;

export type Install =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly reason: string };

const run = promisify(execFile);

const installed = (dir: string) => existsSync(join(dir, "node_modules/vitest/package.json"));

async function npmInstall(dir: string, mode: "--offline" | "--prefer-offline"): Promise<void> {
  await run(
    "npm",
    [
      "install",
      mode,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      "--fetch-retries=0",
      "--fetch-timeout=20000",
      `vitest@${VITEST_VERSION}`,
    ],
    { cwd: dir, timeout: INSTALL_TIMEOUT_MS },
  );
}

let pending: Promise<Install> | null = null;

/** The cached install, made on first use. Never rejects: a failure is a reason to skip. */
export function vitestInstall(): Promise<Install> {
  pending ??= install();
  return pending;
}

async function install(): Promise<Install> {
  if (!VITEST_VERSION.startsWith("5.")) {
    return { ok: false, reason: `the repository's Vitest is ${VITEST_VERSION}, not 5.x` };
  }
  const dir = join(CACHE_ROOT, KEY);
  if (installed(dir)) return { ok: true, dir };
  mkdirSync(CACHE_ROOT, { recursive: true });
  const tmp = mkdtempSync(`${dir}.tmp-`);
  try {
    writeFileSync(
      join(tmp, "package.json"),
      `${JSON.stringify({ name: "squeal-e2e-fixture", private: true, type: "module" })}\n`,
    );
    const errors: string[] = [];
    for (const mode of ["--offline", "--prefer-offline"] as const) {
      try {
        await npmInstall(tmp, mode);
        break;
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr ?? String(error);
        errors.push(`npm install ${mode}: ${stderr.trim().split("\n").slice(-3).join(" ")}`);
      }
    }
    if (!installed(tmp)) {
      return {
        ok: false,
        reason: `vitest@${VITEST_VERSION} could not be installed: ${errors.join("; ")}`,
      };
    }
    try {
      renameSync(tmp, dir);
    } catch (error) {
      if (!installed(dir)) throw error;
    }
    return { ok: true, dir };
  } catch (error) {
    return { ok: false, reason: `vitest@${VITEST_VERSION} could not be cached: ${String(error)}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
