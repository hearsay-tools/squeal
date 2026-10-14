import { describe, expect, it } from "vitest";
import { appendNote, NOTES_PER_TOPIC, readDaemonNotes, withNote } from "../src/core/notes.js";
import { persistedNoteTexts } from "../src/core/scheduler/notes.js";
import { type DaemonNote, MAX_PERSISTED_NOTES, notesMetaKey } from "../src/core/types/index.js";
import { fakeCommonDir, open } from "./store/helpers.js";

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

  it("read back a shutdown's incarnation, and drop one that is not a string (wave-13af B1)", () => {
    const store = open(fakeCommonDir());
    appendNote(store, "wt", { at: 1, revision: null, text: "stop", exitOf: "0.1.121@1#t" });
    const raw = JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]") as unknown[];
    store.meta.set(
      notesMetaKey("wt"),
      JSON.stringify([...raw, { at: 2, revision: null, text: "x", exitOf: 7 }]),
    );
    expect(readDaemonNotes(store, "wt")).toEqual([
      { at: 1, revision: null, text: "stop", exitOf: "0.1.121@1#t" },
      { at: 2, revision: null, text: "x" },
    ]);
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

  it("keep stored items as they are, which the read skips when malformed", () => {
    const store = open(fakeCommonDir());
    const foreign = { at: 1, revision: 1, text: "newer", severity: "info" };
    store.meta.set(notesMetaKey("wt"), JSON.stringify([foreign, { at: "x" }]));
    const note = { at: 2, revision: 2, text: "ours" };
    appendNote(store, "wt", note);

    const stored = store.meta.get(notesMetaKey("wt"));
    expect(JSON.parse(stored ?? "[]")).toEqual([foreign, { at: "x" }, note]);
    expect(withNote(stored, note)).toEqual([foreign, { at: "x" }, note, note]);
    expect(readDaemonNotes(store, "wt")).toEqual([{ at: 1, revision: 1, text: "newer" }, note]);
  });
});

/*
 * Task 007-39 (007 lessons.md defect 11), agreed with 001: a note may carry
 * a topic, `<owner>:<subject>`, and status lists only the latest stored note
 * of a topic, so "no Python environment" leaves status once "its Python
 * environment is ready" is written. The store's row keeps every note, the
 * daemon's only record (001 D12), and the new note reaches a reader as any
 * new note does.
 */
describe("persisted notes with a topic (007-39)", () => {
  const TOPIC = "pytest-environment:app";
  const missing = { at: 1, revision: null, text: "no Python environment", topic: TOPIC };
  const ready = { at: 3, revision: 2, text: "its Python environment is ready", topic: TOPIC };

  it("list only the latest note of a topic; untagged notes and other topics stay", () => {
    const store = open(fakeCommonDir());
    appendNote(store, "wt", missing);
    appendNote(store, "wt", { at: 2, revision: 1, text: "untagged" });
    appendNote(store, "wt", { at: 2, revision: 1, text: "other", topic: "pytest-environment:b" });
    appendNote(store, "wt", ready);
    expect(readDaemonNotes(store, "wt")).toEqual([
      { at: 2, revision: 1, text: "untagged" },
      { at: 2, revision: 1, text: "other", topic: "pytest-environment:b" },
      ready,
    ]);
  });

  it("keep the replaced note in the store's row, the notes' history", () => {
    const store = open(fakeCommonDir());
    appendNote(store, "wt", missing);
    appendNote(store, "wt", ready);
    expect(JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]")).toEqual([missing, ready]);
    expect(readDaemonNotes(store, "wt")).toEqual([ready]);
  });

  it("leave an older store's notes, which have no topic, as they are", () => {
    const store = open(fakeCommonDir());
    const old = { at: 1, revision: null, text: "no Python environment" };
    store.meta.set(notesMetaKey("wt"), JSON.stringify([old]));
    appendNote(store, "wt", ready);
    expect(readDaemonNotes(store, "wt")).toEqual([old, ready]);
  });

  it("deliver the replacing note once, as a new note, to a reader told the old one", () => {
    const store = open(fakeCommonDir());
    appendNote(store, "wt", missing);
    const told = readDaemonNotes(store, "wt");
    expect(told).toEqual([missing]);
    const seen = Math.max(...told.map((n) => n.at));

    appendNote(store, "wt", ready);
    expect(readDaemonNotes(store, "wt").filter((n) => n.at > seen)).toEqual([ready]);
  });

  it("list a note that comes back after its replacement, and the restart dedupe reads that view", () => {
    const store = open(fakeCommonDir());
    appendNote(store, "wt", missing);
    appendNote(store, "wt", ready);
    const back = { ...missing, at: 5, revision: 3 };
    appendNote(store, "wt", back);
    expect(readDaemonNotes(store, "wt")).toEqual([back]);
    expect(persistedNoteTexts(store, "wt")).toEqual(new Set([missing.text]));
  });

  it(`store at most ${NOTES_PER_TOPIC} notes of a topic, so its comings and goings evict no other note`, () => {
    const store = open(fakeCommonDir());
    const unrelated = { at: 0, revision: null, text: "watcher dropped events" };
    appendNote(store, "wt", unrelated);
    for (let i = 1; i <= 10; i++) {
      appendNote(store, "wt", i % 2 === 1 ? { ...missing, at: i } : { ...ready, at: i });
    }
    const stored = JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]") as DaemonNote[];
    expect(NOTES_PER_TOPIC).toBe(3);
    expect(stored).toEqual([
      unrelated,
      { ...ready, at: 8 },
      { ...missing, at: 9 },
      { ...ready, at: 10 },
    ]);
    expect(readDaemonNotes(store, "wt")).toEqual([unrelated, { ...ready, at: 10 }]);
  });
});
