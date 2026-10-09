import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { linkTargets } from "../../src/core/scheduler/link-target.js";

/** Task 001-148: the target of a path read through a directory link, whether it exists or not. */
it("names the in-scope target of a link's path, existing or not, and nothing else", async () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "squeal-link-out-")));
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-link-")));
  mkdirSync(join(root, "data/deep"), { recursive: true });
  mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
  symlinkSync("data", join(root, "linked"));
  symlinkSync(".", join(root, "self"));
  symlinkSync(outside, join(root, "out"));
  symlinkSync("node_modules/pkg", join(root, "pkg"));

  expect(
    await linkTargets(root, [
      "linked/absent.txt",
      "linked/deep/absent.txt",
      "self/top.txt",
      "data/plain.txt",
      "top.txt",
      "out/x.txt",
      "pkg/index.js",
      "missing/x.txt",
    ]),
  ).toEqual(["data/absent.txt", "data/deep/absent.txt", "top.txt"]);
});
