import { describe, expect, it } from "vitest";
import { RefusedObserved, refusedNote } from "../../src/core/scheduler/refused-observed.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Row 011-310 (issue #166): the stored observed paths closure assembly
 * cannot take enter the key in its runtime part, and are noted once per
 * change. With none, the part stays as given, so no valid key moves.
 */

const A: TestFileRef = { project: "server", path: "test/a.test.mjs" };
const BAD = String.raw`\home\agent\cache`;
const RUNTIME = '["squeal-runtime-files/1",[".runtime/port.json"]]';

function refused(persisted: readonly string[] = []) {
  const notes: string[] = [];
  const keys = new RefusedObserved(
    (text) => notes.push(text),
    (text) => persisted.includes(text),
  );
  return { keys, notes };
}

describe("refused observed paths (row 011-310)", () => {
  it("leave the runtime part as given while every path is valid", () => {
    const { keys, notes } = refused();
    expect(keys.keyed(A, ["data/x.txt", "data/"], "")).toBe("");
    expect(keys.keyed(A, ["data/x.txt"], RUNTIME)).toBe(RUNTIME);
    expect(notes).toEqual([]);
  });

  it("name the refused paths beside the runtime part, so the key differs", () => {
    const { keys } = refused();
    const marked = keys.keyed(A, [BAD, "data/x.txt"], RUNTIME);
    expect(JSON.parse(marked)).toEqual(["squeal-refused-observed/1", [BAD], RUNTIME]);
    expect(keys.keyed(A, [BAD], "")).not.toBe("");
  });

  it("are noted once per change, and not at first sight when an earlier daemon noted them", () => {
    const { keys, notes } = refused([refusedNote(A, [BAD])]);
    keys.keyed(A, [BAD], "");
    keys.keyed(A, [BAD], "");
    expect(notes).toEqual([]);
    keys.keyed(A, [BAD, "/abs"], "");
    keys.keyed(A, [], "");
    keys.keyed(A, [BAD], "");
    expect(notes).toEqual([refusedNote(A, [BAD, "/abs"]), refusedNote(A, [BAD])]);
  });

  it("name the project, the test file and each path", () => {
    expect(refusedNote(A, [BAD])).toBe(
      `observed path left out of server:test/a.test.mjs: "${BAD}" is not a worktree-relative path; ` +
        "the file's key marks its closure incomplete, so no result stored before the path was observed is reused",
    );
    expect(refusedNote(A, [BAD, "/abs"])).toBe(
      `observed paths left out of server:test/a.test.mjs: "${BAD}", "/abs" are not worktree-relative paths; ` +
        "the file's key marks its closure incomplete, so no result stored before the paths were observed is reused",
    );
  });
});
