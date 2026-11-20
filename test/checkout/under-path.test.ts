import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonical, pathArgs, underFolder } from "../../src/core/checkout/under-path.js";

/*
 * Row 023-31, review wave-18 B1: only a whole path argument, resolved,
 * lies under a checkout; an embedded checkout path, a sibling that only
 * starts with its name, and `..` out of it do not.
 */

let base: string;
let checkout: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-under-")));
  checkout = join(base, "c1");
  mkdirSync(join(checkout, "run"), { recursive: true });
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const under = (...argv: string[]) => underFolder(canonical(checkout), null, ["node", ...argv]);

describe("a path under a checkout", () => {
  it("is a whole argument or an option's value, existing or not", () => {
    expect(under(`${checkout}/tree/server.js`)).toBe(true);
    expect(under(`--user-data-dir=${checkout}/run/profile`)).toBe(true);
    expect(under("-x", `-p=${checkout}`)).toBe(true);
    expect(under(checkout)).toBe(true);
    expect(under(`${checkout}/`)).toBe(true);
    expect(under(`${checkout}//run/./a`)).toBe(true);
  });

  it("is not a checkout path embedded in another path or a string", () => {
    expect(under(`/another-root${checkout}/file.js`)).toBe(false);
    expect(under(`--data=/another-root${checkout}`)).toBe(false);
    expect(under(`file://${checkout}/x`)).toBe(false);
    expect(under(`cd ${checkout} && x`)).toBe(false);
  });

  it("is not a sibling whose name starts with the checkout's", () => {
    for (const sibling of ["2", ":other", "-x", ".bak", " (copy)", "_y", "+z"])
      expect(under(`${checkout}${sibling}/file`), sibling).toBe(false);
  });

  it("is not a path that leaves the checkout through ..", () => {
    expect(under(`${checkout}/../outside`)).toBe(false);
    expect(under(`${checkout}/run/../../c1x`)).toBe(false);
    expect(under(`--dir=${checkout}/..`)).toBe(false);
    expect(under(`${checkout}/run/../tree`)).toBe(true);
  });

  it("follows symlinks both ways", () => {
    const alias = join(base, "alias");
    symlinkSync(checkout, alias);
    expect(under(`${alias}/run/profile`)).toBe(true);
    expect(underFolder(canonical(alias), null, ["node", `${checkout}/run`])).toBe(true);
    // A link inside the checkout that points out of it is not under it.
    mkdirSync(join(base, "outside"));
    symlinkSync(join(base, "outside"), join(checkout, "out"));
    expect(under(`${checkout}/out/file`)).toBe(false);
  });

  it("reads a cwd, removed or not, by whole components", () => {
    const real = canonical(checkout);
    expect(underFolder(real, `${checkout}/run`, [])).toBe(true);
    expect(underFolder(real, `${checkout}/run (deleted)`, [])).toBe(true);
    expect(underFolder(real, `${checkout}2`, [])).toBe(false);
    expect(underFolder(real, `/another-root${checkout}`, [])).toBe(false);
  });
});

describe("the path arguments", () => {
  it("split a command line rewritten into one string at spaces", () => {
    expect(pathArgs(["/opt/chrome --type=renderer --user-data-dir=/x/run/p --lang=en"])).toEqual([
      "/opt/chrome",
      "/x/run/p",
    ]);
    expect(pathArgs(["node", "relative/x", "-e", "1", "--k=v", "/a"])).toEqual(["/a"]);
  });
});
