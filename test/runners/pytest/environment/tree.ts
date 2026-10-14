import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

/*
 * Synthetic Python environments for spec 007 D2: hand-written `pyvenv.cfg`,
 * `.pth`, `direct_url.json` and finder files, never a real interpreter
 * unless a test links one in.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh directory, its real path, removed after the test. */
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-env-")));
  dirs.push(dir);
  return dir;
}

/** Writes each relative path with its content under `dir`. */
export function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

export function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
}

export const SITE = "lib/python3.13/site-packages";

/**
 * A uv-style environment at `<dir>/<at>`: `pyvenv.cfg`, `bin/python` (an
 * empty file unless `python` names an interpreter to link), site-packages
 * with `files` relative to it. Returns its absolute path.
 */
export function venv(
  dir: string,
  at: string,
  site: Readonly<Record<string, string>> = {},
  python?: string,
): string {
  const env = join(dir, at);
  write(env, {
    "pyvenv.cfg": [
      "home = /opt/uv/python/cpython-3.13-linux-x86_64-gnu/bin",
      "implementation = CPython",
      "uv = 0.12.2",
      "version_info = 3.13",
      "include-system-site-packages = false",
      "",
    ].join("\n"),
  });
  if (python === undefined) write(env, { "bin/python": "" });
  else link(python, join(env, "bin", "python"));
  mkdirSync(join(env, SITE), { recursive: true });
  write(join(env, SITE), site);
  return env;
}

/** A PEP 610 `direct_url.json` for an editable install of `projectDir`. */
export function editable(projectDir: string): string {
  return JSON.stringify({ url: `file://${projectDir}`, dir_info: { editable: true } });
}
