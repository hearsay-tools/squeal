import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { appendNote, readDaemonNotes } from "../../src/core/notes.js";
import { CommandHold } from "../../src/core/scheduler/command-hold.js";
import { readCommandHolds } from "../../src/core/scheduler/hold-rows.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import { notesMetaKey, type Store } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { fakeCommonDir, open } from "../store/helpers.js";
import { catchUpRepo, catchUpSide } from "./catch-up-fixture.js";
import { heldFiles, hold, liveProcess, notes, tokens } from "./command-hold-fixture.js";

/*
 * Row 011-231 (011 C9 as amended 2026-10-21, *Hold command*): a check removes
 * an ended entry and writes its note in one write, so a reader on another
 * connection sees the entry or its note, never neither. On main CI
 * `test/daemon/hold.test.ts` case 2 read the row gone and no note: the
 * removal and the note were two commits.
 */

const ID = "w";

/** A command hold over `store`; each note is persisted as the scheduler's `#note` persists it. */
function commandHold(
  store: Store,
  gone: () => boolean,
  onNote: (text: string) => void = () => {},
): CommandHold {
  return new CommandHold({
    store,
    worktreeId: ID,
    now: Date.now,
    note: (text) => {
      onNote(text);
      appendNote(store, ID, { at: Date.now(), revision: null, text });
    },
    merging: () => false,
    due: () => {},
    gone,
  });
}

const view = (store: Store) => ({
  entries: readCommandHolds(store, ID).length,
  notes: readDaemonNotes(store, ID).map((n) => n.text),
});

/** The end note of an entry the fixture's `hold` wrote with no child: its wrapper is this process. */
const ended = (command: string, last: boolean) =>
  `the hold for \`${command}\` (pid ${process.pid}) ended: its command is gone${last ? "; validating again" : ""}`;

describe("a command hold's removal and its notes are one write (row 011-231)", () => {
  it("another connection sees the ended entries until their notes commit with the removal", () => {
    const dir = fakeCommonDir();
    const store = open(dir);
    const other = open(dir);
    hold({ store, worktreeId: ID }, null, { command: "sleep 6" });
    hold({ store, worktreeId: ID }, null, { command: "sleep 7" });
    const seen: ReturnType<typeof view>[] = [];
    const held = commandHold(
      store,
      () => true,
      () => seen.push(view(other)),
    );

    expect(held.check()).toBe(false);
    expect(seen).toEqual([
      { entries: 2, notes: [] },
      { entries: 2, notes: [] },
    ]);
    expect(view(other)).toEqual({
      entries: 0,
      notes: [ended("sleep 6", false), ended("sleep 7", true)],
    });
    held.close();
  });

  it("a busy store leaves the entry and writes no note; the next check removes it with its note", () => {
    const dir = fakeCommonDir();
    hold({ store: open(dir), worktreeId: ID }, null, { command: "sleep 6" });
    const store = openStore(dir, { busyTimeoutMs: 50 });
    if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
    const rival = new DatabaseSync(storePaths(dir).database);
    let gone = false;
    const held = commandHold(store, () => gone);
    try {
      expect(held.check()).toBe(true);
      gone = true;
      rival.exec("BEGIN IMMEDIATE");
      expect(held.check()).toBe(true);
      expect(view(store)).toEqual({ entries: 1, notes: [] });
      rival.exec("ROLLBACK");

      expect(held.check()).toBe(false);
      expect(view(store)).toEqual({ entries: 0, notes: [ended("sleep 6", true)] });
    } finally {
      held.close();
      rival.close();
      store.close();
    }
  });

  it("the scheduler writes the end note through the store whose transaction removes the entry", async () => {
    const files = heldFiles(2, 0);
    const repo = catchUpRepo(files);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 4, policy: RUN_MISSING });
    await side.scheduler.start();
    await side.scheduler.idle();
    const command = await liveProcess();
    hold(side, command.identity, { wrapper: null });
    expect(await side.scheduler.commandHold()).toBe(true);
    await command.end();

    const note = `the hold for \`npm run gate\` (pid ${command.identity.pid}) ended: its command is gone; validating again`;
    const other = open(join(repo.main, ".git"));
    const set = side.store.meta.set;
    // The entries another connection reads when the scheduler's own store writes the end note.
    let atNote: number | null = null;
    vi.spyOn(side.store.meta, "set").mockImplementation((key, value) => {
      if (atNote === null && key === notesMetaKey(side.worktreeId) && value.includes(note)) {
        atNote = readCommandHolds(other, side.worktreeId).length;
      }
      set(key, value);
    });

    expect(await side.scheduler.commandHold()).toBe(false);
    expect(atNote).toBe(1);
    expect(tokens(side)).toEqual([]);
    expect(notes(side)).toContain(note);
  });
});
