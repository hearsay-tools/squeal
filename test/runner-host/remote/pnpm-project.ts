import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, lutimesSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Review 0.1.454 B1: a project that real pnpm installs offline, for the
 * remote install's tests. Its one dependency is a tarball beside it, so no
 * registry is asked; its `pnpm-workspace.yaml` keeps pnpm's store, cache and
 * state under the test's scratch directory, never the user's, and stops
 * pnpm from finding a workspace above it.
 */

/** The `pnpm` on `PATH`, or `null` when none answers. */
export const PNPM: string | null = (() => {
  const found = spawnSync("sh", ["-c", "command -v pnpm"], { encoding: "utf8" });
  const path = found.stdout.trim();
  if (found.status !== 0 || path === "") return null;
  return spawnSync(path, ["--version"], { encoding: "utf8" }).status === 0 ? path : null;
})();

/**
 * Writes the project at `root`, its pnpm data under `data`: a manifest, the
 * dependency's tarball and pnpm's settings. No lockfile: `pnpm install` here
 * writes one.
 */
export function writePnpmProject(root: string, data: string): void {
  const pkg = join(data, "dep-source", "package");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(pkg, "package.json"), '{"name":"dep","version":"1.0.0","main":"index.js"}');
  writeFileSync(join(pkg, "index.js"), "module.exports = 1;\n");
  execFileSync("tar", ["-czf", join(root, "dep-1.0.0.tgz"), "-C", join(pkg, ".."), "package"]);
  writeFileSync(
    join(root, "package.json"),
    '{"name":"app","version":"1.0.0","dependencies":{"dep":"file:dep-1.0.0.tgz"}}\n',
  );
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    ["store", "cache", "state"].map((dir) => `${dir}Dir: ${join(data, dir)}\n`).join(""),
  );
}

/** Installs the project at `root` with real pnpm: its lockfile and `node_modules`. */
export function pnpmInstall(root: string): void {
  if (PNPM === null) throw new Error("no pnpm");
  execFileSync(PNPM, ["install"], { cwd: root, stdio: "ignore" });
}

/**
 * An env whose `pnpm` is the real one, each call first counted as a line
 * of `count`.
 */
export function countedPnpm(bin: string, count: string): NodeJS.ProcessEnv {
  if (PNPM === null) throw new Error("no pnpm");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "pnpm"),
    `#!/bin/sh\necho "pnpm $*" >> ${JSON.stringify(count)}\nexec ${JSON.stringify(PNPM)} "$@"\n`,
  );
  chmodSync(join(bin, "pnpm"), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

/** As a restore onto a new machine leaves it: the dependency's link newer than pnpm's `lock.yaml`. */
export function restoreMoved(root: string): void {
  const later = new Date(Date.now() + 86_400_000);
  lutimesSync(join(root, "node_modules/dep"), later, later);
}

/** As an earlier release wrote `installed.json`: `{ locks, modules }`, no fingerprint. */
export function earlierRecord(record: string): void {
  const { installed: _installed, ...earlier } = JSON.parse(readFileSync(record, "utf8")) as {
    installed?: string;
  };
  writeFileSync(record, JSON.stringify(earlier));
}

/** How many lines `count` holds. */
export function counted(count: string): number {
  try {
    return readFileSync(count, "utf8")
      .split("\n")
      .filter((line) => line !== "").length;
  } catch {
    return 0;
  }
}
