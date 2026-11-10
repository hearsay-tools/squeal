import { describe, expect, it } from "vitest";
import { blob, evidenceOf } from "./ci-evidence-kit.js";

/*
 * Spec 018 D9 (the human, 2026-11-09, repair R3 of 018-17: "one path, one
 * content per run"). A path the run saw with two contents, or with content
 * and absence, or a directory it listed with two sets of names, has no
 * evidence, even when both reads fall in one event-loop turn and the change
 * came from outside Node. A write cancels a path's evidence through every
 * file API: a descriptor or file handle opened to write, a write stream, a
 * copy, a truncate, a time change. A write through a symbolic link cancels
 * the path it reaches; a read through one records the path it reaches.
 */

const GOOD = "GOOD";

describe("evidence per path is one content for the whole run (rule 1)", () => {
  it("drops a path a writer outside Node changed between two reads in one turn", () => {
    // The third review's case: the export kept only the second read's hash.
    const script = `import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
const sh = (line) => execFileSync("sh", ["-c", line]);
readFileSync("data/v.txt");
sh("printf BAD! > data/v.txt");
readFileSync("data/v.txt");
readdirSync("dir");
sh("touch dir/new.txt");
readdirSync("dir");
readFileSync("data/gone.txt");
sh("rm data/gone.txt");
existsSync("data/gone.txt");
readFileSync("data/kept.txt");
`;
    const files = {
      "data/v.txt": GOOD,
      "dir/a.txt": "a",
      "data/gone.txt": "g",
      "data/kept.txt": "k",
    };
    expect(evidenceOf(script, files)).toEqual({
      "data/kept.txt": blob("k"),
      "script.mjs": blob(script),
    });
  });
});

describe("a write cancels evidence through every file API (rule 2)", () => {
  it("cancels a path written through a descriptor, a handle, a stream, a copy or a link, content unchanged", () => {
    const script = `import * as fs from "node:fs";
import { once } from "node:events";
import { open } from "node:fs/promises";
const ROUTES = ["fd", "numeric", "handle", "stream", "constructed", "append", "truncate", "copy", "cp", "times", "linked"];
for (const name of ROUTES) fs.readFileSync(\`\${name}.txt\`);
fs.readFileSync("kept.txt");
const fd = fs.openSync("fd.txt", "r+");
fs.writeSync(fd, "GOOD", 0);
fs.closeSync(fd);
const numeric = fs.openSync("numeric.txt", fs.constants.O_WRONLY);
fs.writeSync(numeric, "GOOD", 0);
fs.closeSync(numeric);
const handle = await open("handle.txt", "r+");
await handle.write("GOOD", 0);
await handle.close();
const stream = fs.createWriteStream("stream.txt");
stream.end("GOOD");
await once(stream, "finish");
const constructed = new fs.WriteStream("constructed.txt");
constructed.end("GOOD");
await once(constructed, "finish");
fs.appendFileSync("append.txt", "");
fs.truncateSync("truncate.txt", 4);
fs.copyFileSync("kept.txt", "copy.txt");
fs.cpSync("kept.txt", "cp.txt");
fs.utimesSync("times.txt", 1, 1);
fs.linkSync("linked.txt", "hard.txt");
`;
    const routes = ["fd", "numeric", "handle", "stream", "constructed", "append", "truncate"];
    const files = Object.fromEntries(routes.map((name) => [`${name}.txt`, GOOD]));
    for (const name of ["copy", "cp", "times", "linked", "kept"]) files[`${name}.txt`] = GOOD;
    expect(evidenceOf(script, files)).toEqual({
      "kept.txt": blob(GOOD),
      "script.mjs": blob(script),
    });
  });
});

describe("symbolic links (rule 3)", () => {
  it("cancels the path a write through a link reaches, and records the path a read reaches", () => {
    const script = `import * as fs from "node:fs";
fs.readFileSync("real/v.txt");
fs.writeFileSync("link.txt", "GOOD");
fs.readFileSync("real/w.txt");
const fd = fs.openSync("dirlink/w.txt", "r+");
fs.closeSync(fd);
fs.readFileSync("real/s.txt");
fs.createWriteStream("dirlink/s.txt").end("GOOD");
fs.readFileSync("dirlink/x.txt");
fs.readFileSync("read.txt");
`;
    const files = Object.fromEntries(["v", "w", "s", "x", "y"].map((n) => [`real/${n}.txt`, GOOD]));
    const links = { "link.txt": "real/v.txt", dirlink: "real", "read.txt": "real/y.txt" };
    expect(evidenceOf(script, files, links)).toEqual({
      "dirlink/x.txt": blob(GOOD),
      "read.txt": blob("real/y.txt"),
      "real/x.txt": blob(GOOD),
      "real/y.txt": blob(GOOD),
      "script.mjs": blob(script),
    });
  });
});
