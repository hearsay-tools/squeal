import { describe, expect, it } from "vitest";
import { lockFileFor, storePaths } from "../../src/core/store/index.js";

describe("storePaths (spec 001 D1)", () => {
  it("lays the store out under <common-dir>/squeal/", () => {
    expect(storePaths("/r/.git")).toEqual({
      dir: "/r/.git/squeal",
      database: "/r/.git/squeal/store.sqlite",
      runsDir: "/r/.git/squeal/runs",
      locksDir: "/r/.git/squeal/locks",
    });
    expect(lockFileFor("/r/.git", "0123456789abcdef")).toBe(
      "/r/.git/squeal/locks/0123456789abcdef.sqlite",
    );
  });
});
