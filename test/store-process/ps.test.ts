import { describe, expect, it } from "vitest";
import { storeProcessLines, storeProcessOf } from "../../src/core/ps/store-processes.js";

/* Spec 021 D22.2 (row 021-36): `squeal ps` lists the store processes. */

const CMDLINES: Readonly<Record<number, readonly string[]>> = {
  10: ["node", "/opt/squeal/cli/squeal.mjs", "daemon", "/repo"],
  11: [
    "squeal pro store",
    "/opt/squeal/cli/squeal.mjs",
    "store-process",
    "/repo/.git",
    "--store",
    "code",
  ],
  12: ["node", "/tmp/other.mjs", "store-process", "/repo/.git"],
  13: ["vim", "store-process"],
};

describe("squeal ps and the store processes (row 021-36)", () => {
  it("finds a store process by its command line after a squeal script, and nothing else", () => {
    const found = Object.entries(CMDLINES).flatMap(([pid, args]) => {
      const store = storeProcessOf(Number(pid), args);
      return store === null ? [] : [store];
    });
    expect(found).toEqual([{ pid: 11, file: "code", commonDir: "/repo/.git" }]);
    expect(storeProcessLines(found)).toEqual([
      "",
      "Store processes",
      "  11  code.sqlite of /repo/.git",
    ]);
    expect(storeProcessLines([])).toEqual([]);
  });
});
