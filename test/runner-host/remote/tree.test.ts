import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writesFor } from "../../../src/core/runner-host/remote/tree.js";
import { treeBlob, unpackFiles } from "../../../src/core/runner-host/remote/tree-wire.js";

/*
 * Row 021-25 (`boat-trial.md` D6): the tree went to the remote as base64 in
 * JSON, a third larger than its bytes. Each write's file bytes now ride
 * gzip-compressed, then base64, in one field; the host unpacks them by the
 * files' sizes and refuses a write whose bytes do not add up.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-tree-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function root(files: Readonly<Record<string, string>>): string {
  const dir = join(scratch, `r${++n}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const source = (i: number) =>
  `export function f${i}(a: number): number {\n  return a + ${i};\n}\n`.repeat(200);

describe("the tree on the wire (row 021-25)", () => {
  it("sends a write's files gzip-compressed, smaller than their bytes, and the host gets them back", async () => {
    const files = Object.fromEntries([0, 1, 2].map((i) => [`src/f${i}.ts`, source(i)]));
    const dir = root(files);
    const paths = Object.keys(files);
    const [write, ...more] = await writesFor(dir, [...paths, "gone.ts"], new Set(paths));
    expect(more).toEqual([]);
    if (write === undefined) throw new Error("no write");
    const packed = Buffer.from(write.gzip, "base64");
    // gzip's framing: its magic bytes, then deflate.
    expect([...packed.subarray(0, 3)]).toEqual([0x1f, 0x8b, 8]);
    const raw = Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    expect(write.gzip.length).toBeLessThan(raw / 10);
    expect(write.removed).toEqual(["gone.ts"]);
    expect(write.files.map((file) => [file.path, file.size])).toEqual(
      paths.map((path) => [path, Buffer.byteLength(files[path] ?? "")]),
    );
    const unpacked = await unpackFiles(write);
    expect(unpacked.map(({ file, bytes }) => [file.path, bytes.toString("utf8")])).toEqual(
      Object.entries(files),
    );
    expect(unpacked.every(({ file, bytes }) => treeBlob(bytes) === file.blob)).toBe(true);
  });

  it("carries empty files and links, and a write of removals alone has no bytes", async () => {
    const dir = root({ "empty.txt": "" });
    const [write] = await writesFor(dir, ["empty.txt"], new Set(["empty.txt"]));
    expect(write?.files).toEqual([{ path: "empty.txt", blob: treeBlob(Buffer.alloc(0)), size: 0 }]);
    expect((await unpackFiles(write ?? { files: [], gzip: "" }))[0]?.bytes.byteLength).toBe(0);
    expect(await writesFor(dir, ["gone"], new Set())).toEqual([
      { files: [], gzip: "", removed: ["gone"] },
    ]);
  });

  it("splits writes by their bytes before compression", async () => {
    const dir = root({ a: "a".repeat(600), b: "b".repeat(600), c: "c".repeat(600) });
    const writes = await writesFor(dir, ["a", "b", "c"], new Set(["a", "b", "c"]), 1_000);
    expect(writes.map((write) => write.files.map((file) => file.path))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("refuses a write whose bytes are not as long as its files say", async () => {
    const dir = root({ a: "abc" });
    const [write] = await writesFor(dir, ["a"], new Set(["a"]));
    if (write === undefined) throw new Error("no write");
    const longer = { ...write, files: write.files.map((file) => ({ ...file, size: 4 })) };
    await expect(unpackFiles(longer)).rejects.toThrow(/holds 3 bytes, its files 4/);
    const shorter = { ...write, files: write.files.map((file) => ({ ...file, size: 2 })) };
    await expect(unpackFiles(shorter)).rejects.toThrow(/do not unpack/);
    await expect(unpackFiles({ ...write, gzip: "bm90IGd6aXA=" })).rejects.toThrow(/do not unpack/);
  });

  // Review 0.1.454 S1: sizes that still add up, and blobs that still match, are refused.
  it("refuses negative, fractional and unsafe sizes, and bytes in a write without files", async () => {
    const dir = root({ a: "a", b: "b" });
    const [write] = await writesFor(dir, ["a", "b"], new Set(["a", "b"]));
    if (write === undefined) throw new Error("no write");
    const sized = (...sizes: number[]) => ({
      ...write,
      files: write.files.map((file, i) => ({ ...file, size: sizes[i] ?? 0 })),
    });
    expect((await unpackFiles(sized(1, 1))).map(({ bytes }) => bytes.toString())).toEqual([
      "a",
      "b",
    ]);
    await expect(unpackFiles(sized(-1, 3))).rejects.toThrow(/size of "a" is no byte count: -1/);
    await expect(unpackFiles(sized(1.5, 0.5))).rejects.toThrow(/size of "a" is no byte count: 1.5/);
    await expect(unpackFiles(sized(1, 2 ** 53))).rejects.toThrow(/size of "b" is no byte count/);
    await expect(unpackFiles(sized(Number.NaN, 2))).rejects.toThrow(/no byte count: NaN/);
    const max = Number.MAX_SAFE_INTEGER;
    await expect(unpackFiles(sized(max, max))).rejects.toThrow(/add up past a byte count/);
    await expect(unpackFiles({ files: [], gzip: write.gzip })).rejects.toThrow(
      /a write without files carries bytes/,
    );
    expect(await unpackFiles({ files: [], gzip: "" })).toEqual([]);
  });
});
