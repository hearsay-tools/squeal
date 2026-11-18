import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeHidden } from "../../src/core/commit/at-keys-side.js";
import { checkoutChange, isUnder } from "../../src/core/commit/at-keys-verify.js";
import { CheckoutFailed } from "../../src/core/commit/at-keys-walk.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git } from "./at-keys-fixture.js";

/*
 * Row 023-11, spec 023 D5.3: a path `--without` hides in a side's checkout
 * is out of its expected tree. The whole-checkout check holds while the
 * path is absent and names it when it is there.
 */

describe("checkoutChange with hidden paths (row 023-11)", () => {
  it("holds while the hidden file and folder are absent, and names one that is there", async () => {
    const f = fixture({ "config/local.txt": "a\n", "data/x/one.txt": "1\n", "src/a.ts": "a\n" });
    const head = git(f.root, "rev-parse", "HEAD").trim();
    const hidden = ["config/local.txt", "data/x"];
    expect(await checkoutChange(f.root, f.root, head, new Set(), new Map(), hidden)).toBe(
      "config/local.txt",
    );
    rmSync(join(f.root, "config/local.txt"));
    expect(await checkoutChange(f.root, f.root, head, new Set(), new Map(), hidden)).toBe("data/x");
    rmSync(join(f.root, "data/x"), { recursive: true });
    expect(await checkoutChange(f.root, f.root, head, new Set(), new Map(), hidden)).toBeNull();
    // Without the hiding, the absent paths are a change.
    expect(await checkoutChange(f.root, f.root, head)).toBe("config/local.txt");
    // A folder put back empty is there: the run would see it.
    mkdirSync(join(f.root, "data/x"));
    expect(await checkoutChange(f.root, f.root, head, new Set(), new Map(), hidden)).toBe("data/x");
  });

  it("tells a path under a folder from one that only shares its prefix", () => {
    expect(isUnder("data/x/one.txt", ["data/x"])).toBe(true);
    expect(isUnder("data/x", ["data/x"])).toBe(true);
    expect(isUnder("data/xy", ["data/x"])).toBe(false);
  });

  it("removes a hidden path without following a link (review wave-9 B2)", () => {
    const f = fixture({ "src/a.ts": "a\n" });
    const tree = join(f.dir, "tree") as AbsolutePath;
    const outside = join(f.dir, "outside");
    mkdirSync(join(outside, "victim"), { recursive: true });
    writeFileSync(join(outside, "victim", "file"), "must survive\n");
    mkdirSync(join(tree, "real", "gone"), { recursive: true });
    writeFileSync(join(tree, "real", "gone", "x"), "x\n");
    symlinkSync(outside, join(tree, "linked"));
    symlinkSync(join(outside, "victim"), join(tree, "real", "terminal"));
    writeFileSync(join(tree, "file"), "f\n");

    expect(() => removeHidden(tree, "linked/victim")).toThrow(CheckoutFailed);
    expect(() => removeHidden(tree, "linked/victim")).toThrow(
      "--without linked/victim lies under a link in the checkout: linked",
    );
    expect(() => removeHidden(tree, "file/x")).toThrow("lies under a file in the checkout: file");
    // A link at the path itself is removed as a link; its target stays.
    removeHidden(tree, "real/terminal");
    expect(existsSync(join(tree, "real", "terminal"))).toBe(false);
    removeHidden(tree, "real/gone");
    expect(existsSync(join(tree, "real", "gone"))).toBe(false);
    removeHidden(tree, "missing/x");
    expect(readFileSync(join(outside, "victim", "file"), "utf8")).toBe("must survive\n");
    expect(lstatSync(join(tree, "linked")).isSymbolicLink()).toBe(true);
  });
});
