// Throwaway probe for 011-81: per root, today's installed-dependency
// fingerprint and the candidate one without the root and workspace packages'
// own versions. Reads files only (lstat, readdir, readFile); starts nothing.
// Usage: tsx lockfile-parts.ts <code-root> <root>...
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [codeRoot, ...roots] = process.argv.slice(2);
const keys = await import(join(codeRoot, "src/core/keys/index.ts"));
const HIDDEN = "node_modules/.package-lock.json";
const installedLocation = (path: string) => path.startsWith("node_modules/") || path.includes("/node_modules/");

/** The hidden lockfile without its top-level name and version and each workspace entry's version. */
function withoutOwnVersions(content: string): string {
  const parsed = JSON.parse(content);
  delete parsed.name;
  delete parsed.version;
  for (const [location, entry] of Object.entries<Record<string, unknown>>(parsed.packages ?? {})) {
    if (!installedLocation(location)) delete entry.version;
  }
  return JSON.stringify(parsed);
}

for (const root of roots) {
  const read = (path: string) => { try { return readFileSync(join(root, path), "utf8"); } catch { return null; } };
  const manifest = read("package.json");
  const hidden = read(HIDDEN);
  const installed = await keys.installedDependencies(root, root);
  console.log(JSON.stringify({
    root: root.replace(/\/$/, "").split("/").pop()?.slice(0, 8),
    packageJson: manifest === null ? null : JSON.parse(manifest).version,
    installedVersion: hidden === null ? null : JSON.parse(hidden).version,
    fingerprint: installed.fingerprint.slice(0, 12),
    stale: installed.note !== null,
    candidate: hidden === null ? null : createHash("sha256").update(`${HIDDEN}\0`).update(withoutOwnVersions(hidden)).digest("hex").slice(0, 12),
  }));
}
