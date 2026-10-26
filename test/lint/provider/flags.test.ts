import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reads } from "../../../src/core/lint/provider/observe.js";

/*
 * Wave 1.8 (review 0.1.353 B1-R4): an open whose descriptor can read is
 * one the observer cannot hash, for every flag Node accepts. Node is the
 * table: each flag is opened on a scratch file and its descriptor read.
 */

const dir = mkdtempSync(join(tmpdir(), "squeal-lint-flags-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let files = 0;

/** Whether a descriptor Node opens with `flags` reads; `null` when Node refuses the flags. */
function nodeReads(flags: string | number): boolean | null {
  const file = join(dir, `f${files++}`);
  let fd: number;
  try {
    fd = openSync(file, flags);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ERR_INVALID_ARG_VALUE" || code === "EINVAL") return null;
    if (code !== "ENOENT") throw error;
    // A flag that does not create: the file must be there.
    writeFileSync(file, "x");
    fd = openSync(file, flags);
  }
  try {
    readSync(fd, Buffer.alloc(1), 0, 1, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EBADF") return false;
    throw error;
  } finally {
    closeSync(fd);
  }
}

/** Every string of up to three of Node's flag letters. */
function candidates(): string[] {
  const letters = ["r", "w", "a", "s", "x", "+"];
  let level = [""];
  const all: string[] = [];
  for (let length = 1; length <= 3; length++) {
    level = level.flatMap((prefix) => letters.map((letter) => prefix + letter));
    all.push(...level);
  }
  return all;
}

describe("the observer's open flags (review 0.1.353 B1-R4)", () => {
  it("count as a read exactly when Node's descriptor reads, for every string flag Node accepts", () => {
    const table = candidates().flatMap((flags) => {
      const read = nodeReads(flags);
      return read === null ? [] : [[flags, read] as const];
    });
    // Node's documented flags: r, rs, sr, r+, rs+, sr+, w, wx, xw, w+, wx+, xw+, a, ax, xa, as, sa, a+, ax+, xa+, as+, sa+.
    expect(table.length).toBe(22);
    expect(
      table
        .filter(([, read]) => !read)
        .map(([flags]) => flags)
        .sort(),
    ).toEqual(["a", "as", "ax", "sa", "w", "wx", "xa", "xw"]);
    for (const [flags, read] of table) expect(reads(flags), flags).toBe(read);
  });

  it("count as a read exactly when Node's descriptor reads, for numeric flags", () => {
    const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_APPEND, O_TRUNC, O_SYNC, O_EXCL } = constants;
    const extras = [0, O_CREAT, O_APPEND, O_TRUNC, O_SYNC, O_CREAT | O_EXCL, O_APPEND | O_CREAT];
    for (const mode of [O_RDONLY, O_WRONLY, O_RDWR]) {
      for (const extra of extras) {
        const flags = mode | extra;
        expect(reads(flags), String(flags)).toBe(nodeReads(flags));
      }
    }
  });

  it("count as a read when no flags are given, and for an access mode Node cannot open", () => {
    expect(reads(undefined)).toBe(true);
    expect(reads(null)).toBe(true);
    expect(reads(() => {})).toBe(true);
    expect(reads(constants.O_WRONLY | constants.O_RDWR)).toBe(true);
    expect(reads("not a flag")).toBe(true);
  });
});
