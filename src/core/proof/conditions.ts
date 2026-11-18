import { mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AbsolutePath, RelativePath } from "../types/common.js";

/*
 * Spec 023 D5.3 (row 023-11): a proof's named conditions. `--env NAME=`
 * unsets a variable and `--env NAME=value` sets it; `--without <path>`
 * hides a file or folder. A path in the repository is hidden in the
 * side's checkout; a path under `HOME` is hidden by giving the run its own
 * `HOME`, which holds everything else the real one does (`ownHome`). The
 * same conditions apply to both sides, and a side under any of them always
 * runs and is never stored: the key does not record them.
 */

/** One `--env`: `value` `null` unsets the variable. */
export interface EnvCondition {
  readonly name: string;
  readonly value: string | null;
}

/** One `--without`, placed: as given, and where it is hidden. */
export type Without =
  | { readonly given: string; readonly where: "repository"; readonly path: RelativePath }
  | { readonly given: string; readonly where: "home"; readonly path: string };

export interface Conditions {
  readonly env: readonly EnvCondition[];
  readonly without: readonly Without[];
}

export const NO_CONDITIONS: Conditions = { env: [], without: [] };

export function hasConditions(conditions: Conditions): boolean {
  return conditions.env.length > 0 || conditions.without.length > 0;
}

/** `rel` from `from` to `to` in `/` form; `null` when `to` lies outside `from`. */
function under(from: string, to: string): string | null {
  const rel = relative(from, to);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * Where `given` (from `cwd`) is hidden: in the repository at `root` first,
 * then under `home`; a usage problem for any other path, the repository
 * itself and its `.git`.
 */
export function placeWithout(
  given: string,
  cwd: AbsolutePath,
  root: AbsolutePath,
  home: string | undefined,
): Without | { readonly usage: string } {
  const path = resolve(cwd, given);
  const inRepo = under(root, path);
  if (inRepo !== null) {
    if (inRepo === "" || inRepo === ".git" || inRepo.startsWith(".git/"))
      return { usage: `--without ${given}: the repository and its .git cannot be hidden` };
    return { given, where: "repository", path: inRepo };
  }
  const inHome = home === undefined || home === "" ? null : under(resolve(home), path);
  if (inHome !== null) return { given, where: "home", path: inHome };
  return {
    usage: `--without ${given}: only a path in the repository or under HOME can be hidden`,
  };
}

/**
 * Review wave-9 B2: the first of `path` and its parent folders that
 * `entries` (a commit's tree) holds as a link; `null` when none is. A
 * removal through a link parent would delete outside the checkout.
 */
export function linkOnPath(
  path: RelativePath,
  entries: ReadonlyMap<RelativePath, { readonly mode: string }>,
): RelativePath | null {
  const parts = path.split("/");
  for (let at = 1; at <= parts.length; at++) {
    const prefix = parts.slice(0, at).join("/");
    if (entries.get(prefix)?.mode === "120000") return prefix;
  }
  return null;
}

/** The paths hidden in the side's checkout. */
export function hiddenInRepository(conditions: Conditions): RelativePath[] {
  return conditions.without.flatMap((w) => (w.where === "repository" ? [w.path] : []));
}

/** The paths hidden under `HOME`, relative to it; `""` hides all of it. */
export function hiddenInHome(conditions: Conditions): string[] {
  return conditions.without.flatMap((w) => (w.where === "home" ? [w.path] : []));
}

/**
 * The run's environment: `env` with each `--env` applied, and `HOME` set
 * to `home` when the run has its own.
 */
export function conditionedEnv(
  env: NodeJS.ProcessEnv,
  conditions: Conditions,
  home: string | null,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const { name, value } of conditions.env) {
    if (value === null) delete out[name];
    else out[name] = value;
  }
  if (home !== null) out.HOME = home;
  return out;
}

/**
 * D5.3: a `HOME` at `into` that holds everything `home` does except the
 * `hidden` paths. Each folder on the way to a hidden path is a real folder
 * here; every other entry is a link to the real one, so the run reads all
 * else as before. Removing `into` removes the links, never what they point to.
 */
export function ownHome(home: string, hidden: readonly string[], into: string): void {
  mkdirSync(into, { recursive: true });
  if (hidden.includes("")) return;
  mirror(home, hidden, into);
}

function mirror(real: string, hidden: readonly string[], into: string): void {
  let names: string[];
  try {
    names = readdirSync(real);
  } catch {
    return;
  }
  for (const name of names) {
    if (hidden.includes(name)) continue;
    const inner = hidden.flatMap((path) =>
      path.startsWith(`${name}/`) ? [path.slice(name.length + 1)] : [],
    );
    const source = join(real, name);
    if (inner.length > 0 && isFolder(source)) {
      mkdirSync(join(into, name));
      mirror(source, inner, join(into, name));
    } else symlinkSync(source, join(into, name));
  }
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The conditions in words, for the report: `--env CI= (unset)`, `--without ~/.npmrc (own HOME)`. */
export function conditionWords(conditions: Conditions): string[] {
  return [
    ...conditions.env.map(({ name, value }) =>
      value === null ? `--env ${name}= (unset)` : `--env ${name}=${value}`,
    ),
    ...conditions.without.map((w) =>
      w.where === "home"
        ? `--without ${w.given} (own HOME)`
        : `--without ${w.given} (hidden in the checkout)`,
    ),
  ];
}
