import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { takeRecorded } from "../../../src/runners/observe/read.js";

describe("takeRecorded", () => {
  /*
   * A virtual module id (Vite's `\0vite/dynamic-import-helper.js`) recorded as a path made
   * `statSync` throw ERR_INVALID_ARG_VALUE and every check of the worktree unknown (2026-10-08).
   */
  it("drops a recorded path that holds a null byte and keeps the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-read-"));
    const line = {
      t: "/w/test/a.test.ts",
      f: ["/w/\u0000vite/dynamic-import-helper.js", "/w/data.txt"],
      l: ["/w/\u0000x"],
      w: [],
    };
    writeFileSync(join(dir, "1.ndjson"), `${JSON.stringify(line)}\n`);
    const entry = takeRecorded(dir).get("/w/test/a.test.ts");
    expect([...(entry?.paths ?? [])]).toEqual(["/w/data.txt"]);
    expect([...(entry?.listed ?? [])]).toEqual([]);
  });

  it("reads recursive listings, each a listing too (task 001-139)", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-read-"));
    const line = { t: "/w/t.ts", l: ["/w/tree", "/w/flat"], r: ["/w/tree", "/w/\u0000x"] };
    writeFileSync(join(dir, "1.ndjson"), `${JSON.stringify(line)}\n`);
    const entry = takeRecorded(dir).get("/w/t.ts");
    expect([...(entry?.listed ?? [])]).toEqual(["/w/tree", "/w/flat"]);
    expect([...(entry?.recursive ?? [])]).toEqual(["/w/tree"]);
  });

  it("reads what a process the test file started imported (spec 016 D4, row 016-22)", () => {
    const dir = mkdtempSync(join(tmpdir(), "squeal-read-"));
    const lines = [
      { t: "/w/t.ts", f: ["/w/child.mjs", "/w/data.txt"], d: ["/w/child.mjs", "/w/\u0000x"] },
      { t: "/w/t.ts", f: ["/w/dep.mjs"], d: ["/w/dep.mjs"] },
    ];
    writeFileSync(join(dir, "1.ndjson"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    const entry = takeRecorded(dir).get("/w/t.ts");
    expect([...(entry?.paths ?? [])]).toEqual(["/w/child.mjs", "/w/data.txt", "/w/dep.mjs"]);
    expect([...(entry?.direct ?? [])]).toEqual(["/w/child.mjs", "/w/dep.mjs"]);
  });
});
