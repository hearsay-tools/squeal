import { readFileSync } from "node:fs";

/**
 * `version` from the package manifest three levels up from `src/core/daemon`
 * or `dist/core/daemon`. Recorded with the daemon (D10) and part of every
 * environment hash (D3).
 */
export function squealVersion(): string {
  const manifest = new URL("../../../package.json", import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    return String(parsed.version);
  }
  throw new Error(`squeal: no version in ${manifest.pathname}`);
}
