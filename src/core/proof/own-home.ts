import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 023 D5.3 (row 023-11, review wave-9 B1; the human, 2026-11-18,
 * "B"): a run with a path under `HOME` hidden gets a `HOME` of its own
 * that starts empty. `--home-keep <path under HOME>` copies a file or
 * folder in, byte for byte, never through a link: a link anywhere in a
 * kept path, or in a folder above it, is refused. The hidden path is
 * never copied, even from a kept folder that holds it. Nothing in the own
 * `HOME` resolves into the real one, so a test can neither read nor
 * change a real `HOME` file through it, and its removal touches only it.
 */

/** One `--home-keep`: as given, and its path relative to `HOME`. */
export interface HomeKeep {
  readonly given: string;
  readonly path: string;
}

/** Whether `path` is `folder` or lies under it; `""` is all of `HOME`. */
export function within(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/**
 * Where `given` (from `cwd`) lies under `home`, checked: a usage problem
 * for a path outside `HOME`, one in a `hidden` path, one that is missing,
 * and one with a link in it or in a folder above it.
 */
export function placeKeep(
  given: string,
  cwd: AbsolutePath,
  home: string | undefined,
  hidden: readonly string[],
): HomeKeep | { readonly usage: string } {
  const problem = (why: string) => ({ usage: `--home-keep ${given}: ${why}` });
  if (home === undefined || home === "") return problem("HOME is not set");
  const rel = relative(resolve(home), resolve(cwd, given));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return problem("only a path under HOME can be kept");
  const path = rel.split(sep).join("/");
  const hiding = hidden.find((h) => within(path, h));
  if (hiding !== undefined)
    return problem(`it lies in the hidden path ${hiding === "" ? "HOME" : `~/${hiding}`}`);
  const link = linkIn(home, path, hidden);
  if (link === undefined) return problem("no such file or folder");
  if (link !== null) return problem(`~/${link} is a link; a kept path must hold none`);
  return { given, path };
}

/**
 * The first link at `path` under `home`, in a folder above it, or in it
 * (the hidden paths left out); `null` when none; `undefined` when `path`
 * is missing.
 */
function linkIn(home: string, path: string, hidden: readonly string[]): string | null | undefined {
  const parts = path === "" ? [] : path.split("/");
  for (let at = 1; at < parts.length; at++) {
    const above = parts.slice(0, at).join("/");
    const stats = lstatSync(join(home, above), { throwIfNoEntry: false });
    if (stats === undefined) return undefined;
    if (stats.isSymbolicLink() || !stats.isDirectory()) return above;
  }
  return linkBelow(home, path, hidden);
}

function linkBelow(
  home: string,
  path: string,
  hidden: readonly string[],
): string | null | undefined {
  if (hidden.some((h) => within(path, h))) return null;
  const stats = lstatSync(join(home, path), { throwIfNoEntry: false });
  if (stats === undefined) return undefined;
  if (stats.isSymbolicLink()) return path;
  if (!stats.isDirectory()) return null;
  for (const name of readdirSync(join(home, path))) {
    const found = linkBelow(home, path === "" ? name : `${path}/${name}`, hidden);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

/**
 * The own `HOME` at `into`: empty, then each `keep` copied in from `home`
 * without following a link (a link found now, or a folder above it that
 * became one, throws), the `hidden` paths left out. A kept path under
 * another kept one is copied with it.
 */
export function ownHome(
  home: string,
  hidden: readonly string[],
  keep: readonly string[],
  into: string,
): void {
  mkdirSync(into, { recursive: true });
  const sorted = [...new Set(keep)].sort();
  const roots = sorted.filter((path, at) => !sorted.slice(0, at).some((k) => within(path, k)));
  for (const path of roots) {
    const parts = path === "" ? [] : path.split("/");
    for (let at = 1; at < parts.length; at++) {
      const above = parts.slice(0, at).join("/");
      const stats = lstatSync(join(home, above));
      if (stats.isSymbolicLink() || !stats.isDirectory())
        throw new Error(`~/${above} is not a folder; the kept ~/${path} is not copied`);
      mkdirSync(join(into, above), { recursive: true });
    }
    copyTree(home, into, path, hidden);
  }
}

function copyTree(home: string, into: string, path: string, hidden: readonly string[]): void {
  if (hidden.some((h) => within(path, h))) return;
  const from = join(home, path);
  const stats = lstatSync(from);
  if (stats.isSymbolicLink()) throw new Error(`~/${path} is a link; a kept path must hold none`);
  if (stats.isDirectory()) {
    if (path !== "") mkdirSync(join(into, path), { recursive: true });
    for (const name of readdirSync(from))
      copyTree(home, into, path === "" ? name : `${path}/${name}`, hidden);
  } else if (stats.isFile()) {
    // Exclusive: a link made at the destination since fails the copy, never takes it.
    copyFileSync(from, join(into, path), constants.COPYFILE_EXCL);
  }
  // A socket, a FIFO or a device is not copied: no test reads one as a file.
}
