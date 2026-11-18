import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutChange, isUnder } from "../../src/core/commit/at-keys-verify.js";
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
});
