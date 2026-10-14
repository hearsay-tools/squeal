import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "../../../core/fs/index.js";
import type { AbsolutePath } from "../../../core/types/index.js";
import { listOptional, pthFiles, readOptional, sitePackagesDir } from "./site.js";

/**
 * The files of an environment that D2's hash and fingerprint read, in a
 * stable order: "the bytes of `pyvenv.cfg`; the sorted site-packages entry
 * names; the bytes of every `.pth` and every `direct_url.json`". The
 * lockfile is not among them: "a lock edit changes nothing until a sync."
 */
export interface EnvironmentFiles {
  readonly pyvenvCfg: string | null;
  /** The interpreter's real path and stat; in the fingerprint, not the hash (the query stands for it). */
  readonly interpreter: { readonly realPath: AbsolutePath; readonly stat: string } | null;
  /** site-packages entry names, `__pycache__` left out: a first import writes it. */
  readonly siteEntries: readonly string[];
  /** `[file name, bytes]` of every `.pth`, in `site`'s order. */
  readonly pth: readonly (readonly [string, string])[];
  /** `[.dist-info name, bytes]` of every `direct_url.json`. */
  readonly directUrls: readonly (readonly [string, string])[];
}

/** Reads `EnvironmentFiles` of `env` and its `python`; about 2 ms (environments 3). */
export function readEnvironmentFiles(env: AbsolutePath, python: AbsolutePath): EnvironmentFiles {
  const site = sitePackagesDir(env);
  const siteEntries =
    site === null ? [] : listOptional(site).filter((name) => name !== "__pycache__");
  const pth: (readonly [string, string])[] = [];
  const directUrls: (readonly [string, string])[] = [];
  if (site !== null) {
    for (const name of pthFiles(site)) pth.push([name, readOptional(join(site, name)) ?? ""]);
    for (const name of siteEntries) {
      if (!name.endsWith(".dist-info")) continue;
      const text = readOptional(join(site, name, "direct_url.json"));
      if (text !== null) directUrls.push([name, text]);
    }
  }
  return {
    pyvenvCfg: readOptional(join(env, "pyvenv.cfg")),
    interpreter: interpreterStat(python),
    siteEntries,
    pth,
    directUrls,
  };
}

/**
 * D2's sync check: "the environment fingerprint differs before and after a
 * run". A digest of every file input, with the interpreter's stat, so a
 * venv recreated in place moves it too.
 */
export function environmentFingerprint(files: EnvironmentFiles): string {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function interpreterStat(python: AbsolutePath): EnvironmentFiles["interpreter"] {
  try {
    const realPath = realpathSync(python);
    const s = statSync(realPath, { bigint: true });
    return { realPath, stat: `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}` };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
