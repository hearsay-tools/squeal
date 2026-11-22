import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/* Row 024-04 (spec 024 D4.4): the recorder asks the system once per path for a symlink's target. */

type Realpath = (abs: string) => string;
const { realpathCache } = createRequire(import.meta.url)(
  "../../../src/runners/observe/recorder.cjs",
) as { realpathCache: (realpath: Realpath, limit?: number) => Realpath };

function counting(answer: (abs: string) => string) {
  const asked: string[] = [];
  const realpath = (abs: string) => {
    asked.push(abs);
    return answer(abs);
  };
  return { realpath, asked };
}

describe("the recorder's realpath cache", () => {
  it("asks once per path and answers the same target after", () => {
    const fake = counting((abs) => `/real${abs}`);
    const cached = realpathCache(fake.realpath);
    expect([cached("/a"), cached("/a"), cached("/b"), cached("/a")]).toEqual([
      "/real/a",
      "/real/a",
      "/real/b",
      "/real/a",
    ]);
    expect(fake.asked).toEqual(["/a", "/b"]);
  });

  it("keeps no failure: a path that threw is asked again and resolves once it exists", () => {
    let exists = false;
    const fake = counting((abs) => {
      if (!exists) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return abs;
    });
    const cached = realpathCache(fake.realpath);
    expect(() => cached("/made")).toThrow("ENOENT");
    expect(() => cached("/made")).toThrow("ENOENT");
    exists = true;
    expect(cached("/made")).toBe("/made");
    expect(cached("/made")).toBe("/made");
    expect(fake.asked).toEqual(["/made", "/made", "/made"]);
  });

  it("starts over once it holds its limit", () => {
    const fake = counting((abs) => abs);
    const cached = realpathCache(fake.realpath, 2);
    for (const abs of ["/a", "/b", "/c", "/a"]) cached(abs);
    // `/c` found the cache full and cleared it, so `/a` was asked again.
    expect(fake.asked).toEqual(["/a", "/b", "/c", "/a"]);
  });

  it("still records a module loaded through a link with its target", { timeout: 60_000 }, () => {
    const seen = observe(
      { "main.mjs": 'import "./linked/lib.mjs";\n', "real/lib.mjs": "export {};\n" },
      "main.mjs",
      { links: { linked: "real" } },
    );
    expect(seen.paths).toEqual(
      expect.arrayContaining(["linked/lib.mjs", "main.mjs", "real/lib.mjs"]),
    );
  });
});
