import { describe, expect, it } from "vitest";
import { listingHash } from "../../../src/core/ci/inputs.js";
import { blob, evidenceOf, fill, temp } from "./ci-evidence-kit.js";

/*
 * Spec 018 D9, row 018-23 (review `wave-5-0.1.421-r3.md` B1 and N2). An
 * open hashes its path; a read through the descriptor, file handle or
 * directory handle consumes what the file or directory holds at that read.
 * Each such read hashes it again, so a writer outside Node that changed it
 * after the open leaves two contents, and the path has no evidence. A time
 * change through a descriptor or file handle is a write, as `utimes` is.
 */

const GOOD = "GOOD";
const BAD = "BAD!";

/** Each consumer opens its file read-only, `sh` rewrites the file, then the consumer reads. */
const CONSUMERS: Record<string, string> = {
  readSync: `{ const fd = fs.openSync("readSync.txt", "r"); sh("readSync.txt"); fs.readSync(fd, bytes, 0, 4, 0); fs.closeSync(fd); }`,
  read: `{ const fd = fs.openSync("read.txt", "r"); sh("read.txt"); await new Promise((r) => fs.read(fd, bytes, 0, 4, 0, r)); fs.closeSync(fd); }`,
  readvSync: `{ const fd = fs.openSync("readvSync.txt", "r"); sh("readvSync.txt"); fs.readvSync(fd, [bytes], 0); fs.closeSync(fd); }`,
  readv: `{ const fd = fs.openSync("readv.txt", "r"); sh("readv.txt"); await new Promise((r) => fs.readv(fd, [bytes], 0, r)); fs.closeSync(fd); }`,
  readFileSync: `{ const fd = fs.openSync("readFileSync.txt", "r"); sh("readFileSync.txt"); fs.readFileSync(fd, "utf8"); fs.closeSync(fd); }`,
  readFile: `{ const fd = fs.openSync("readFile.txt", "r"); sh("readFile.txt"); await new Promise((r) => fs.readFile(fd, r)); fs.closeSync(fd); }`,
  fstatSync: `{ const fd = fs.openSync("fstatSync.txt", "r"); sh("fstatSync.txt"); fs.fstatSync(fd); fs.closeSync(fd); }`,
  opened: `{ const fd = await new Promise((r) => fs.open("opened.txt", (e, fd) => r(fd))); sh("opened.txt"); fs.readSync(fd, bytes, 0, 4, 0); fs.closeSync(fd); }`,
  fdStream: `{ const fd = fs.openSync("fdStream.txt", "r"); sh("fdStream.txt"); for await (const c of fs.createReadStream(null, { fd })) {} }`,
  handleRead: `{ const h = await open("handleRead.txt", "r"); sh("handleRead.txt"); await h.read(bytes, 0, 4, 0); await h.close(); }`,
  handleReadv: `{ const h = await open("handleReadv.txt", "r"); sh("handleReadv.txt"); await h.readv([bytes], 0); await h.close(); }`,
  handleReadFile: `{ const h = await open("handleReadFile.txt", "r"); sh("handleReadFile.txt"); await h.readFile("utf8"); await h.close(); }`,
  promisesReadFile: `{ const h = await open("promisesReadFile.txt", "r"); sh("promisesReadFile.txt"); await readFile(h); await h.close(); }`,
  handleStream: `{ const h = await open("handleStream.txt", "r"); sh("handleStream.txt"); for await (const c of h.createReadStream()) {} }`,
  handleLines: `{ const h = await open("handleLines.txt", "r"); sh("handleLines.txt"); for await (const l of h.readLines()) {} }`,
  handleWeb: `{ const h = await open("handleWeb.txt", "r"); sh("handleWeb.txt"); for await (const c of h.readableWebStream()) {} await h.close(); }`,
  handleStat: `{ const h = await open("handleStat.txt", "r"); sh("handleStat.txt"); await h.stat(); await h.close(); }`,
};

const PRELUDE = `import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { open, opendir, readFile } from "node:fs/promises";
const sh = (file) => execFileSync("sh", ["-c", 'printf BAD! > "$1"', "sh", file]);
const bytes = Buffer.alloc(4);
`;

describe("reads through an open descriptor or handle (018-23, review 0.1.421-r3 B1)", () => {
  it("drops a file rewritten outside Node after the open, for each way to read through it", () => {
    const script = `${PRELUDE}${Object.values(CONSUMERS).join("\n")}
{ const fd = fs.openSync("kept.txt", "r"); fs.readSync(fd, bytes, 0, 4, 0); fs.closeSync(fd); }
{ const h = await open("keptHandle.txt", "r"); await h.read(bytes, 0, 4, 0); await h.readFile(); await h.close(); }
`;
    const files = Object.fromEntries(Object.keys(CONSUMERS).map((name) => [`${name}.txt`, GOOD]));
    const evidence = evidenceOf(script, { ...files, "kept.txt": GOOD, "keptHandle.txt": GOOD });
    expect(evidence).toEqual({
      "kept.txt": blob(GOOD),
      "keptHandle.txt": blob(GOOD),
      "script.mjs": blob(script),
    });
  });

  it("keeps the content an open descriptor reads when the file did not change", () => {
    const script = `${PRELUDE}
{ const fd = fs.openSync("a.txt", "r"); fs.readSync(fd, bytes, 0, 4, 0); fs.readFileSync(fd); fs.closeSync(fd); }
for await (const c of fs.createReadStream("b.txt")) {}
`;
    expect(evidenceOf(script, { "a.txt": GOOD, "b.txt": BAD })).toEqual({
      "a.txt": blob(GOOD),
      "b.txt": blob(BAD),
      "script.mjs": blob(script),
    });
  });

  it("drops a directory listed through an open directory handle after its names changed, read to its end or closed", () => {
    const root = temp();
    fill(root, { "kept/a.txt": "a" });
    const kept = listingHash(root, "kept");
    const script = `${PRELUDE}
const add = (file) => execFileSync("sh", ["-c", 'touch "$1"', "sh", file]);
{ const d = fs.opendirSync("sync"); add("sync/new.txt"); while (d.readSync() !== null) {} d.closeSync(); }
{ const d = await opendir("iterated"); add("iterated/new.txt"); for await (const e of d) {} }
{ const d = fs.opendirSync("closed"); add("closed/new.txt"); d.readSync(); d.closeSync(); }
{ const d = fs.opendirSync("kept"); while (d.readSync() !== null) {} d.closeSync(); }
`;
    const files = {
      "sync/a.txt": "a",
      "iterated/a.txt": "a",
      "closed/a.txt": "a",
      "kept/a.txt": "a",
    };
    expect(evidenceOf(script, files)).toEqual({
      "kept/": kept,
      "script.mjs": blob(script),
    });
  });
});

describe("a time change through a descriptor or handle is a write (018-23, review 0.1.421-r3 N2)", () => {
  it("cancels a path whose times changed through `futimes` or `FileHandle.utimes`", () => {
    const script = `${PRELUDE}
{ const fd = fs.openSync("futimesSync.txt", "r"); fs.futimesSync(fd, 1, 1); fs.closeSync(fd); }
{ const fd = fs.openSync("futimes.txt", "r"); await new Promise((r) => fs.futimes(fd, 1, 1, r)); fs.closeSync(fd); }
{ const h = await open("handle.txt", "r"); await h.utimes(1, 1); await h.close(); }
fs.readFileSync("kept.txt");
`;
    const names = ["futimesSync", "futimes", "handle", "kept"];
    const files = Object.fromEntries(names.map((name) => [`${name}.txt`, GOOD]));
    expect(evidenceOf(script, files)).toEqual({
      "kept.txt": blob(GOOD),
      "script.mjs": blob(script),
    });
  });
});
