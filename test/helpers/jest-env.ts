import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/*
 * Jest installs for the spec 028 fixtures (`test/fixtures/jest/`). The fixture project and one
 * version's pinned `package.json` and `pnpm-lock.yaml` are copied to a folder under the temp
 * directory, keyed by their contents, and installed there with pnpm. No `node_modules` reaches
 * the repository. Squeal's own test runs point `TMPDIR` at a folder per run
 * (`test/global-teardown.ts`), so an install is reused within a run, and pnpm's store makes the
 * next run's install fast. `hoist=false` is pnpm's strictest layout: no hidden
 * `node_modules/.pnpm/node_modules`, so each package reaches only its own dependencies, and a
 * resolver that skips a dependency link fails here (research 028-01). `--ignore-workspace`
 * keeps the install out of any workspace above the temp directory.
 */

export type JestMajor = 29 | 30;

/** The majors spec 028 supports; every fixture test runs on each. */
export const JEST_MAJORS: readonly JestMajor[] = [29, 30];

const FIXTURES = resolve(import.meta.dirname, "../fixtures/jest");
/** The marker pnpm writes once `node_modules` is complete. */
const INSTALLED = join("node_modules", ".modules.yaml");
/** The install command's arguments; part of the folder's key, so a changed flag installs anew. */
const INSTALL = [
  "install",
  "--frozen-lockfile",
  "--ignore-workspace",
  "--ignore-scripts",
  "--prefer-offline",
  "--config.hoist=false",
] as const;

/** Every file under `dir`, relative, sorted. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

function contentKey(major: JestMajor): string {
  const hash = createHash("sha256").update(`${INSTALL.join(" ")}\0`);
  for (const dir of ["project", `jest-${major}`]) {
    for (const file of files(join(FIXTURES, dir))) {
      hash
        .update(`${dir}/${file}\0`)
        .update(readFileSync(join(FIXTURES, dir, file)))
        .update("\0");
    }
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * The root of an installed copy of the fixture project on Jest `major`: `jest.config.js`,
 * `src/`, `test/` and `node_modules/`. Shared between calls: copy it before editing it.
 */
export function installJest(major: JestMajor): string {
  const root = join(tmpdir(), `squeal-jest-${major}-${contentKey(major)}`);
  if (existsSync(join(root, INSTALLED))) return root;
  const scratch = mkdtempSync(`${root}-installing-`);
  try {
    cpSync(join(FIXTURES, "project"), scratch, { recursive: true });
    cpSync(join(FIXTURES, `jest-${major}`), scratch, { recursive: true });
    execFileSync("pnpm", INSTALL, {
      cwd: scratch,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });
    renameSync(scratch, root);
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    // Another process may have installed the same key first.
    if (existsSync(join(root, INSTALLED))) return root;
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`installing the Jest ${major} fixture failed: ${stderr || String(error)}`);
  }
  return root;
}
