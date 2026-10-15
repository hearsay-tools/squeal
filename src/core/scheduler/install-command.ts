import { open } from "node:fs/promises";
import { join } from "node:path";
import { isMissing, isRecord } from "../fs/index.js";
import type { AbsolutePath } from "../types/index.js";

type Manager = "npm" | "pnpm" | "yarn" | "bun";

/** Committed lockfiles, each with its manager; the first found wins. */
const LOCKFILES: readonly { readonly path: string; readonly manager: Manager }[] = [
  { path: "package-lock.json", manager: "npm" },
  { path: "npm-shrinkwrap.json", manager: "npm" },
  { path: "pnpm-lock.yaml", manager: "pnpm" },
  { path: "yarn.lock", manager: "yarn" },
  { path: "bun.lock", manager: "bun" },
  { path: "bun.lockb", manager: "bun" },
];

/** Yarn 1 writes this first line; it knows `--frozen-lockfile`, not `--immutable`. */
const YARN_CLASSIC_HEADER = "# yarn lockfile v1";

/**
 * The command that installs `root`'s dependencies from its lockfile, for
 * the note a worktree without an install shows (task 001-410): `npm ci`,
 * `pnpm install --frozen-lockfile`, `yarn install --immutable` (Yarn 1's
 * `--frozen-lockfile`) or `bun install --frozen-lockfile`. A manifest's
 * `packageManager` picks among several lockfiles; with none, its manager's
 * plain install, else `npm install`.
 */
export async function installCommand(root: AbsolutePath, manifest: unknown): Promise<string> {
  const declared = declaredManager(manifest);
  const found: { path: string; manager: Manager; content: string }[] = [];
  for (const lockfile of LOCKFILES) {
    const content = await readIfPresent(join(root, lockfile.path));
    if (content !== null) found.push({ ...lockfile, content });
  }
  const lockfile = found.find((entry) => entry.manager === declared) ?? found[0];
  if (lockfile === undefined) return `${declared ?? "npm"} install`;
  switch (lockfile.manager) {
    case "npm":
      return "npm ci";
    case "yarn":
      return lockfile.content.includes(YARN_CLASSIC_HEADER)
        ? "yarn install --frozen-lockfile"
        : "yarn install --immutable";
    default:
      return `${lockfile.manager} install --frozen-lockfile`;
  }
}

/** The manager a `packageManager` field such as `pnpm@9.1.0` names, or `null`. */
function declaredManager(manifest: unknown): Manager | null {
  if (!isRecord(manifest) || typeof manifest.packageManager !== "string") return null;
  const name = manifest.packageManager.split("@")[0];
  return LOCKFILES.find((entry) => entry.manager === name)?.manager ?? null;
}

/** Only the head of a lockfile: Yarn's version line is near its top. */
async function readIfPresent(path: AbsolutePath): Promise<string | null> {
  try {
    const file = await open(path, "r");
    try {
      const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(256) });
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isMissing(error) || (error as NodeJS.ErrnoException).code === "EISDIR") return null;
    throw error;
  }
}
