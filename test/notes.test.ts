import { describe, expect, it } from "vitest";
import { appendNote } from "../../src/core/scheduler/notes.js";
import { type DaemonNote, MAX_PERSISTED_NOTES, notesMetaKey } from "../../src/core/types/index.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Spec 001 D7: status shows "the latest persisted daemon notes (runner
 * failures, dropped watcher events, tier pump stopped), kept bounded per
 * worktree in `meta`". Review wave 2, S6.
 */
describe("persisted notes", () => {
  it("are a JSON array per worktree under notes.<worktreeId>, newest last", () => {
    const store = open(fakeCommonDir());
    appendNote(store, "wt-a", { at: 1, revision: null, text: "first" });
    appendNote(store, "wt-a", { at: 2, revision: 3, text: "second" });
    appendNote(store, "wt-b", { at: 3, revision: 1, text: "other" });

    expect(notesMetaKey("wt-a")).toBe("notes.wt-a");
    expect(JSON.parse(store.meta.get("notes.wt-a") ?? "null")).toEqual([
      { at: 1, revision: null, text: "first" },
      { at: 2, revision: 3, text: "second" },
    ]);
    expect(JSON.parse(store.meta.get("notes.wt-b") ?? "null")).toEqual([
      { at: 3, revision: 1, text: "other" },
    ]);
  });

  it(`keep at most ${MAX_PERSISTED_NOTES}, dropping the oldest`, () => {
    const store = open(fakeCommonDir());
    for (let i = 0; i < MAX_PERSISTED_NOTES + 5; i++) {
      appendNote(store, "wt", { at: i, revision: i, text: `note ${i}` });
    }
    const notes = JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]") as DaemonNote[];
    expect(MAX_PERSISTED_NOTES).toBe(20);
    expect(notes).toHaveLength(20);
    expect(notes[0]?.text).toBe("note 5");
    expect(notes.at(-1)?.text).toBe("note 24");
  });

  it("start a new list when the stored value is not a list", () => {
    const store = open(fakeCommonDir());
    store.meta.set(notesMetaKey("wt"), "not json");
    appendNote(store, "wt", { at: 1, revision: null, text: "fresh" });
    expect(JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]")).toEqual([
      { at: 1, revision: null, text: "fresh" },
    ]);
  });

  it("are plain text: ANSI escape codes are stripped (lessons defect 6)", () => {
    const store = open(fakeCommonDir());
    const esc = String.fromCharCode(27);
    const coloured = `runner closure of test/a.test.ts failed: ${esc}[31m[PARSE_ERROR] ${esc}[0mExpected ${esc}[1m;${esc}[22m`;
    appendNote(store, "wt", { at: 1, revision: 2, text: coloured });
    expect(JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]")).toEqual([
      {
        at: 1,
        revision: 2,
        text: "runner closure of test/a.test.ts failed: [PARSE_ERROR] Expected ;",
      },
    ]);
  });
});
