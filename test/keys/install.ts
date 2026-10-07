import { lstatSync, lutimesSync, readdirSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { writeFile } from "../hash/git-repo.js";

/** One installed package of a fixture install. */
export interface FixturePackage {
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  /** Files besides `package.json`; defaults to an `index.js`. */
  readonly files?: Readonly<Record<string, string>>;
  /** A workspace link to this worktree-relative location. */
  readonly link?: string;
  /** More `package.json` fields, such as `type` or `main`. */
  readonly manifest?: Readonly<Record<string, unknown>>;
}

const INSTALLED = new Date("2026-09-10T00:00:00Z");
const LOCKED = new Date("2026-09-12T00:00:00Z");

/**
 * Writes an npm install at `root` the way `npm ci` leaves it: each package
 * folder with its files, then `node_modules/.package-lock.json` listing each
 * with an integrity derived from its version, newer than every folder
 * (task 001-104's rule). Locations are relative to `root`. Writing again
 * over an install bumps it in place.
 */
export function writeInstall(
  root: string,
  packages: Readonly<Record<string, FixturePackage>>,
): void {
  const listed: Record<string, unknown> = { "": { name: "app" } };
  for (const [location, pkg] of Object.entries(packages)) {
    if (pkg.link !== undefined) {
      listed[location] = { resolved: pkg.link, link: true };
      if (lstatSync(join(root, location), { throwIfNoEntry: false })) continue;
      symlinkSync(
        relative(dirname(join(root, location)), join(root, pkg.link)),
        join(root, location),
      );
      continue;
    }
    const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
    const manifest = { name, version: pkg.version, ...pkg.manifest };
    writeFile(root, `${location}/package.json`, JSON.stringify(manifest));
    const files = pkg.files ?? { "index.js": `module.exports = ${JSON.stringify(pkg.version)};\n` };
    for (const [file, content] of Object.entries(files))
      writeFile(root, `${location}/${file}`, content);
    const { files: _files, link: _link, manifest: _manifest, ...entry } = pkg;
    listed[location] = { ...entry, integrity: `sha512-${name}-${pkg.version}` };
  }
  touchFolders(root);
  writeFile(root, "node_modules/.package-lock.json", JSON.stringify({ packages: listed }));
  utimesSync(join(root, "node_modules/.package-lock.json"), LOCKED, LOCKED);
}

/** Sets every folder under each `node_modules` to before the lockfile. */
function touchFolders(root: string): void {
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) lutimesSync(path, INSTALLED, INSTALLED);
      else if (entry.isDirectory()) {
        visit(path);
        utimesSync(path, INSTALLED, INSTALLED);
      }
    }
  };
  if (statSync(join(root, "node_modules"), { throwIfNoEntry: false }))
    visit(join(root, "node_modules"));
}
