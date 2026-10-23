import {
  lstatSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { pnpmFolderName } from "../../src/core/keys/pnpm-lockfile.js";
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
 * (task 001-104's rule), and the root's `name` and `version` at its top, as
 * npm copies them (task 011-85). Locations are relative to `root`. Writing
 * again over an install bumps it in place.
 */
export function writeInstall(
  root: string,
  packages: Readonly<Record<string, FixturePackage>>,
  version = "1.0.0",
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
  const lockfile = { name: "app", version, lockfileVersion: 3, requires: true, packages: listed };
  writeFile(root, "node_modules/.package-lock.json", JSON.stringify(lockfile));
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

/** One snapshot of a fixture pnpm install. */
export interface PnpmSnapshot {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  /** Files besides `package.json`; defaults to an `index.js`. */
  readonly files?: Readonly<Record<string, string>>;
  /** Listed in `.modules.yaml`'s `skipped`, as a platform package pnpm does not install. */
  readonly skipped?: boolean;
}

/** A pnpm install: what `lock.yaml` and `.modules.yaml` record. */
export interface PnpmFixture {
  /** Each importer (`.` the root) and its declared names, to versions as `lock.yaml` writes them. */
  readonly importers: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Snapshots by id, `name@version` and its peers in parentheses. */
  readonly snapshots: Readonly<Record<string, PnpmSnapshot>>;
  /** `.modules.yaml` fields over the defaults of an isolated install, such as `hoistedDependencies`. */
  readonly modules?: Readonly<Record<string, unknown>>;
}

/**
 * Writes a pnpm install at `root` the way pnpm 12 leaves its default
 * (`isolated`) layout: each snapshot's package folder under
 * `node_modules/.pnpm/<folder>/node_modules/<name>`, a link per edge beside
 * it, each importer's links, the hoisted links `.modules.yaml` records, then
 * `node_modules/.pnpm/lock.yaml` newer than every folder and link (task
 * 011-162). Integrities derive from the version. Writing again over an
 * install bumps it in place: the old folders stay, as pnpm's orphans do.
 */
export function writePnpmInstall(root: string, fixture: PnpmFixture): void {
  const skipped = Object.keys(fixture.snapshots).filter((id) => fixture.snapshots[id]?.skipped);
  const modules = {
    hoistedDependencies: {},
    hoistPattern: ["*"],
    layoutVersion: 5,
    nodeLinker: "isolated",
    packageManager: "pnpm@12.11.2",
    publicHoistPattern: [],
    skipped,
    virtualStoreDir: ".pnpm",
    virtualStoreDirMaxLength: 120,
    ...fixture.modules,
  };
  const store = (id: string) => `node_modules/.pnpm/${pnpmFolderName(id, 120)}/node_modules`;
  const packageOf = (id: string) => `${store(id)}/${nameOf(id)}`;
  for (const [id, snapshot] of Object.entries(fixture.snapshots)) {
    if (snapshot.skipped) continue;
    const version = versionOf(id);
    writeFile(root, `${packageOf(id)}/package.json`, JSON.stringify({ name: nameOf(id), version }));
    const files = snapshot.files ?? { "index.js": `module.exports = ${JSON.stringify(id)};\n` };
    for (const [file, content] of Object.entries(files))
      writeFile(root, `${packageOf(id)}/${file}`, content);
    for (const [name, ref] of edgesOf(snapshot)) {
      const child = snapshotId(name, ref);
      if (fixture.snapshots[child]?.skipped !== true)
        link(root, `${store(id)}/${name}`, packageOf(child));
    }
  }
  for (const [path, declared] of Object.entries(fixture.importers)) {
    const dir = path === "." ? "" : `${path}/`;
    for (const [name, ref] of Object.entries(declared)) {
      if (fixture.snapshots[snapshotId(name, ref)]?.skipped === true) continue;
      const target = ref.startsWith("link:")
        ? join(path, ref.slice(5))
        : packageOf(snapshotId(name, ref));
      link(root, `${dir}node_modules/${name}`, target);
    }
  }
  const hoisted = modules.hoistedDependencies as Record<string, Record<string, string>>;
  for (const [id, aliases] of Object.entries(hoisted)) {
    for (const [alias, kind] of Object.entries(aliases)) {
      const at = kind === "public" ? "node_modules" : "node_modules/.pnpm/node_modules";
      link(root, `${at}/${alias}`, packageOf(id));
    }
  }
  writeFile(root, "node_modules/.modules.yaml", JSON.stringify(modules, null, 2));
  for (const path of Object.keys(fixture.importers)) touchFolders(join(root, path));
  writeFile(root, "node_modules/.pnpm/lock.yaml", pnpmLockfileText(fixture));
  utimesSync(join(root, "node_modules/.pnpm/lock.yaml"), LOCKED, LOCKED);
}

/** `lock.yaml` of `fixture` as pnpm 12 writes it. */
export function pnpmLockfileText(fixture: PnpmFixture): string {
  const quoted = (text: string) => (text.startsWith("@") ? `'${text}'` : text);
  const lines = ["lockfileVersion: '9.0'", "", "settings:", "  autoInstallPeers: true"];
  lines.push("  excludeLinksFromLockfile: false", "", "importers:", "");
  for (const [path, declared] of Object.entries(fixture.importers)) {
    const names = Object.keys(declared).sort();
    lines.push(
      names.length === 0 ? `  ${path}: {}` : `  ${path}:`,
      ...(names.length ? ["    dependencies:"] : []),
    );
    for (const name of names) {
      const ref = declared[name] ?? "";
      const specifier = ref.startsWith("link:") ? "workspace:*" : `^${ref.replace(/\(.*$/, "")}`;
      lines.push(
        `      ${quoted(name)}:`,
        `        specifier: ${specifier}`,
        `        version: ${quoted(ref)}`,
      );
    }
    lines.push("");
  }
  const ids = Object.keys(fixture.snapshots).sort();
  lines.push("packages:", "");
  for (const base of [...new Set(ids.map((id) => id.replace(/\(.*$/, "")))].sort()) {
    lines.push(`  ${quoted(base)}:`, `    resolution: {integrity: sha512-${base}}`, "");
  }
  lines.push("snapshots:", "");
  for (const id of ids) {
    const snapshot = fixture.snapshots[id] ?? {};
    const fields = (["dependencies", "optionalDependencies"] as const).filter(
      (field) => snapshot[field],
    );
    lines.push(fields.length === 0 ? `  ${quoted(id)}: {}` : `  ${quoted(id)}:`);
    for (const field of fields) {
      lines.push(`    ${field}:`);
      for (const [name, ref] of Object.entries(snapshot[field] ?? {}))
        lines.push(`      ${quoted(name)}: ${quoted(ref)}`);
    }
    if (snapshot.skipped) lines.push("    optional: true");
    lines.push("");
  }
  return lines.join("\n");
}

function edgesOf(snapshot: PnpmSnapshot): [string, string][] {
  return [snapshot.dependencies, snapshot.optionalDependencies].flatMap((edges) =>
    Object.entries(edges ?? {}),
  );
}

/** The snapshot an edge or an importer's version names: `name@ref`, or `ref` for an alias. */
function snapshotId(name: string, ref: string): string {
  return ref.replace(/\(.*$/, "").indexOf("@", 1) > 0 ? ref : `${name}@${ref}`;
}

function nameOf(id: string): string {
  return id.slice(0, id.indexOf("@", 1));
}

function versionOf(id: string): string {
  return id.slice(id.indexOf("@", 1) + 1).replace(/\(.*$/, "");
}

/** A relative symlink at `path` to `target`, both relative to `root`, replacing one there. */
function link(root: string, path: string, target: string): void {
  const at = join(root, path);
  mkdirSync(dirname(at), { recursive: true });
  if (lstatSync(at, { throwIfNoEntry: false })) rmSync(at, { recursive: true });
  symlinkSync(relative(dirname(at), join(root, target)), at);
}
