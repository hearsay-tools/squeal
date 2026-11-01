import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AbsolutePath } from "../../../types/common.js";
import type { LintOff } from "../../pass/provider.js";

/*
 * Spec 017 D11 "Discovery": the project's own oxlint, resolved as Node
 * resolves `oxlint/package.json` from the root, and its version. Below 1.65
 * it is off: 1.65 added `--debug files`, the only way to ask which named
 * files oxlint skips (`research/oxlint-provider.md` Q1).
 */

export const MIN_VERSION = [1, 65] as const;

export interface OxlintInstall {
  readonly version: string;
  /** The package folder, its real path: what the preload treats as oxlint's own code. */
  readonly packageDir: string;
  /** `bin/oxlint`, which `<node>` runs. */
  readonly bin: string;
}

export function discoverOxlint(root: AbsolutePath): OxlintInstall | LintOff {
  const manifest = findManifest(root);
  if (manifest === null) return { off: `no oxlint installed in ${root}` };
  let parsed: { version?: unknown; bin?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8")) as typeof parsed;
  } catch (error) {
    return { off: `oxlint's package.json does not read: ${(error as Error).message}` };
  }
  const version = typeof parsed.version === "string" ? parsed.version : "";
  if (!atLeast(version, MIN_VERSION)) return { off: "oxlint 1.65 or later is needed" };
  const packageDir = realpathSync(dirname(manifest));
  const bin = binOf(parsed.bin);
  return { version, packageDir, bin: join(packageDir, bin) };
}

/** `<dir>/node_modules/oxlint/package.json` from the root up, as Node looks for a package. */
function findManifest(root: string): string | null {
  for (let dir = root; ; dir = dirname(dir)) {
    const manifest = join(dir, "node_modules", "oxlint", "package.json");
    if (existsSync(manifest)) return manifest;
    if (dirname(dir) === dir) return null;
  }
}

function binOf(bin: unknown): string {
  if (typeof bin === "string") return bin;
  if (typeof bin === "object" && bin !== null) {
    const named = (bin as Record<string, unknown>).oxlint;
    if (typeof named === "string") return named;
  }
  return "bin/oxlint";
}

/** `version` is at least `min`, by its numeric major and minor; a version that does not parse is not. */
export function atLeast(version: string, min: readonly [number, number]): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > min[0] || (major === min[0] && minor >= min[1]);
}
