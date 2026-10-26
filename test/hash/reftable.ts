import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tempDir } from "./git-repo.js";

/** Why this Git cannot create a reftable repository (`--ref-format` came with 2.45), or `null`. */
export function reftableUnsupported(): string | null {
  const probe = tempDir();
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[name];
  try {
    const init = ["init", "-q", "--ref-format=reftable", join(probe.path, "repo")];
    if (spawnSync("git", init, { env, stdio: "ignore" }).status === 0) return null;
    const version = spawnSync("git", ["--version"], { env, encoding: "utf8" }).stdout.trim();
    return `${version} cannot create a reftable repository`;
  } finally {
    probe.cleanup();
  }
}
