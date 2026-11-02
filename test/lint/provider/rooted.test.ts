import fs from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  PATH_ARGUMENTS,
  rootedPath,
  rootFunctions,
} from "../../../src/core/lint/provider/rooted.js";

/*
 * Row 017-27 (review 0.1.391 N1): the worker resolves every relative path an
 * `fs` function takes against the project root. Node is the table: each
 * parameter Node names as a path is one the worker roots.
 */

/** The parameter names Node gives a path, in `fs` and `fs.promises`. */
const PATH_NAMES: ReadonlySet<string> = new Set([
  "path",
  "p",
  "filename",
  "prefix",
  "src",
  "dest",
  "existingPath",
  "oldPath",
  "newPath",
]);

/** A function's parameter names, as its source declares them; `null` when it hides them. */
function parameters(call: unknown): string[] | null {
  const source = Function.prototype.toString.call(call);
  const found = /^(?:async\s+)?function\s*\w*\s*\(([^)]*)\)/.exec(source);
  const names = found?.[1]?.split(",").map((part) => part.trim().split(/[\s=]/)[0] ?? "");
  return names === undefined || names.some((name) => name.startsWith("...")) ? null : names;
}

/** Each `fs` function Node exports, by its name without `Sync`. */
function functions(): (readonly [string, string, unknown])[] {
  const out: (readonly [string, string, unknown])[] = [];
  for (const [owner, prefix] of [
    [fs, "fs."],
    [fs.promises, "fs.promises."],
  ] as const) {
    for (const [name, value] of Object.entries(owner)) {
      if (typeof value !== "function" || /^[A-Z_]/.test(name)) continue;
      out.push([`${prefix}${name}`, name.replace(/Sync$/, ""), value]);
    }
  }
  return out;
}

describe("the worker's relative paths (row 017-27)", () => {
  it("are rooted at every argument Node names as a path", () => {
    const missed: string[] = [];
    for (const [label, base, call] of functions()) {
      const names = parameters(call);
      if (names === null) continue;
      names.forEach((name, index) => {
        if (PATH_NAMES.has(name) && !PATH_ARGUMENTS[base]?.includes(index)) {
          missed.push(`${label} argument ${index} (${name})`);
        }
      });
    }
    expect(missed).toEqual([]);
  });

  it("leave a symlink's target as given: the system reads it from the link's folder", () => {
    const [target, path] = parameters(fs.symlinkSync) ?? [];
    expect([target, path]).toEqual(["target", "path"]);
    expect(PATH_ARGUMENTS.symlink).toEqual([1]);
  });

  it("name only functions Node has", () => {
    const names = new Set(functions().map(([, base]) => base));
    // Node 24 added `mkdtempDisposable`; Node 22 has none, and the worker skips it there.
    const newer = new Set(["mkdtempDisposable"]);
    for (const name of Object.keys(PATH_ARGUMENTS)) {
      if (!newer.has(name)) expect(names, name).toContain(name);
    }
  });

  it("resolve against the root; an absolute path, a descriptor and an empty path stay", () => {
    expect(rootedPath("src/a.js", "/root")).toBe("/root/src/a.js");
    expect(rootedPath("./src/../b.js", "/root")).toBe("/root/b.js");
    expect(rootedPath("src/", "/root")).toBe("/root/src/");
    expect(rootedPath(Buffer.from("a.js"), "/root")).toBe("/root/a.js");
    expect(rootedPath("/elsewhere/a.js", "/root")).toBe("/elsewhere/a.js");
    expect(rootedPath(3, "/root")).toBe(3);
    expect(rootedPath("", "/root")).toBe("");
    const url = new URL("file:///elsewhere/a.js");
    expect(rootedPath(url, "/root")).toBe(url);
  });

  it("are rooted by every form of a wrapped function, its own function properties too", async () => {
    const echo = (...args: unknown[]) => args;
    const realpathSync = Object.assign((...args: unknown[]) => args, { native: echo });
    const exists = (path: unknown, done: (found: unknown) => void) => done(path);
    // As `fs.exists`: a promisified form of its own.
    Object.defineProperty(exists, promisify.custom, {
      value: (path: unknown) => Promise.resolve(path),
    });
    // As `fs.promises.opendir`: its promisified form is itself.
    const opendir = async (path: unknown) => path;
    Object.defineProperty(opendir, promisify.custom, { value: opendir });
    const host = {
      statSync: echo,
      stat: echo,
      realpathSync,
      exists,
      symlinkSync: echo,
      other: echo,
    };
    const promised = { opendir, rename: echo };
    rootFunctions(host, promised, "/root");

    expect(host.statSync("a.js", { bigint: false })).toEqual(["/root/a.js", { bigint: false }]);
    expect(host.stat("a.js", echo)).toEqual(["/root/a.js", echo]);
    expect(host.realpathSync("a.js")).toEqual(["/root/a.js"]);
    expect(host.realpathSync.native("a.js")).toEqual(["/root/a.js"]);
    expect(await promisify(host.exists)("a.js")).toBe("/root/a.js");
    expect(host.symlinkSync("../t.js", "l.js")).toEqual(["../t.js", "/root/l.js"]);
    expect(host.other("a.js")).toEqual(["a.js"]);
    expect(await promised.opendir("src")).toBe("/root/src");
    // The cycle stays closed, on the wrapper.
    expect(Reflect.get(promised.opendir, promisify.custom)).toBe(promised.opendir);
    expect(promised.rename("a.js", "b.js")).toEqual(["/root/a.js", "/root/b.js"]);
  });
});
