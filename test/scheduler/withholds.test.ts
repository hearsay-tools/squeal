import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/index.js";
import { Withholds } from "../../src/core/scheduler/stability.js";

/*
 * Row 011-128: a record decides its withholds before its write and counts
 * them only once the write lands, so `peek` gives `record`'s split and
 * records nothing.
 */

const ranOf = (path: string, key: string) => {
  const ref = { project: "", path };
  return { file: { id: testFileId(ref), ref }, key };
};

const paths = (withheld: { again: readonly { file: { ref: { path: string } } }[] }) =>
  withheld.again.map(({ file }) => file.ref.path);

describe("Withholds.peek (row 011-128)", () => {
  it("gives the split `record` makes and records nothing", () => {
    const withholds = new Withholds();
    const a = ranOf("test/a.test.ts", "k1");
    const b = ranOf("test/b.test.ts", "k1");
    withholds.record([a]);

    const peeked = withholds.peek([a, b]);
    expect(withholds.peek([a, b])).toEqual(peeked);
    expect(paths(peeked)).toEqual(["test/b.test.ts"]);
    expect(peeked.exhausted).toEqual([a]);
    // `b` was only peeked: its first withhold is still to come.
    expect(withholds.record([a, b])).toEqual(peeked);
    expect(withholds.peek([b]).exhausted).toEqual([b]);
  });

  it("reads a cleared file or a new key as a first withhold", () => {
    const withholds = new Withholds();
    const a = ranOf("test/a.test.ts", "k1");
    withholds.record([a]);
    expect(withholds.peek([ranOf("test/a.test.ts", "k2")]).exhausted).toEqual([]);
    withholds.clear([a]);
    expect(paths(withholds.peek([a]))).toEqual(["test/a.test.ts"]);
  });
});
