import { describe, expect, it } from "vitest";
import { timeoutText } from "../../src/cli/no-verdict-lines.js";
import { blockedTexts } from "../../src/cli/proof-green.js";
import { outageOf, reasonOutage, sideOutageText } from "../../src/cli/remote-outage-text.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { appendNote } from "../../src/core/notes.js";
import { recordUnknownFiles } from "../../src/core/scheduler/unknown-files.js";
import { writeRemoteSummary } from "../../src/core/status/remote-status.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { key, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 026-31 (gh-278): a recorded remote outage under `whenLost: "not-run"`
 * is named, with its reason, time, policy and recovery, by a named wait's
 * text and its no-verdict clause, and by proof's unknown side; with none
 * recorded, or under `whenLost: "local"`, or with the selected files
 * current, every text stays as before. `retry` is
 * `remote-outage-retry.test.ts`'s.
 */

const U = "src/u.test.ts";
const C = "src/c.test.ts";
const SINCE = "2026-11-24T20:06:21.678Z";
const UNREACHABLE_NOTE = `remote cmd:lan-1 unreachable since ${SINCE} (the host ended); 3 files not run`;
const UNREACHABLE_SUMMARY =
  "command cmd:lan-1: unreachable (the host ended); background and edit runs of vitest; planning remote; environment match-local";
const REFUSED_RUN =
  'remote cmd:lan-1 refused (degraded disk: 12 MB/s); not run here (whenLost "not-run")';
const REFUSED_SUMMARY =
  "command cmd:lan-1: refused (degraded disk: 12 MB/s); background and edit runs of vitest; planning remote; environment match-local";
const MISSING_PNPM = `remote cmd:lan-1 unreachable since ${SINCE} (missing pnpm); not planned here (whenLost "not-run")`;

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = () => (): DaemonSync => ({ current: synced, stop: () => {} });

/** A worktree at revision 4: `U` keyed with no result (unknown), `C` current. */
function worktree() {
  const { repo, store } = repoWith([], [C]);
  key(store, repo.mainId, U, null);
  return { root: repo.main, id: repo.mainId, store };
}

async function timedOut(root: string, paths: readonly string[]) {
  const wait = await waitForNamed(root, paths, {
    timeoutMs: 60,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: sync(),
    ask: async () => [],
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return { wait, text: namedText(wait, NOW) };
}

function note(store: Store, id: string, text: string, topic = "remote-lane") {
  appendNote(store, id as never, {
    at: NOW as EpochMs,
    revision: 4 as RevisionNumber,
    text,
    topic,
  });
}

function unknownReason(store: Store, id: string, path: string, reason: string) {
  store.transaction(() =>
    recordUnknownFiles(
      store,
      id as never,
      [
        {
          testFile: ref(path),
          key: `key-${path}-done` as CheckKey,
          reason,
          ran: false,
          samples: [],
          revision: 4 as RevisionNumber,
          at: NOW as EpochMs,
        },
      ],
      () => true,
    ),
  );
}

const lines = (text: string) => text.trimEnd().split("\n");

describe("a named wait names the recorded remote outage that holds its files (row 026-31)", () => {
  it("unreachable: a Remote line under the revision, with reason, time, policy and recovery", async () => {
    const w = worktree();
    const before = (await timedOut(w.root, [U])).text;
    writeRemoteSummary(w.store, w.id as never, UNREACHABLE_SUMMARY);
    note(w.store, w.id, UNREACHABLE_NOTE);

    const { text, wait } = await timedOut(w.root, [U]);

    expect(lines(text)[1]).toBe(
      `Remote: remote cmd:lan-1 unreachable since ${SINCE} (the host ended); nothing runs here in its place (whenLost "not-run"); ` +
        `check \`squeal status\`; once the remote is ready, \`squeal retry ${U}\` runs them again and \`squeal status --wait 60000 ${U}\` waits for the result.`,
    );
    // Only that line is added; every other line is as before.
    expect(lines(text).filter((l) => !l.startsWith("Remote: "))).toEqual(lines(before));
    // The file stays unknown: the outage never reads as a pass.
    expect(wait.files.map((f) => f.state)).toEqual(["unknown"]);
    expect(text).not.toMatch(/\bpass\b/);
  });

  it("refused: the selected file's own recorded reason names the remote and the refusal", async () => {
    const w = worktree();
    writeRemoteSummary(w.store, w.id as never, REFUSED_SUMMARY);
    unknownReason(w.store, w.id, U, REFUSED_RUN);

    const { text, wait } = await timedOut(w.root, [U]);

    expect(lines(text)[1]).toMatch(
      /^Remote: remote cmd:lan-1 refused \(degraded disk: 12 MB\/s\); nothing runs here in its place \(whenLost "not-run"\); check `squeal status`/,
    );
    // The lapsed clause keeps the heartbeat and names the outage beside it.
    expect(timeoutText(wait, { result: "none", reason: "lapsed" }, "squeal")).toBe(
      "the daemon's heartbeat had lapsed at the last read; results are as of revision 4; " +
        'remote cmd:lan-1 refused (degraded disk: 12 MB/s); nothing runs here in its place (whenLost "not-run"); ' +
        `once the remote is ready, \`squeal retry ${U}\` runs them again`,
    );
    // So does the default no-verdict clause, after its reason groups.
    const clause = timeoutText(wait, { result: "none", reason: "unknown" } as never, "squeal");
    expect(clause).toMatch(/^1 test file without a current result at revision 4 \(1 unknown\): /);
    expect(clause).toMatch(
      /; remote cmd:lan-1 refused \(degraded disk: 12 MB\/s\); .*`squeal retry/,
    );
  });

  it("an unlisted revision whose listing the remote failed names it, and that it lists once ready", async () => {
    const w = worktree();
    const { wait } = await timedOut(w.root, [U]);
    const unlisted = {
      ...wait,
      result: { ...wait.result, testFilesListed: false, listingFailed: MISSING_PNPM },
    } as typeof wait;
    const plain = {
      ...wait,
      result: { ...wait.result, testFilesListed: false },
    } as typeof wait;

    const text = timeoutText(unlisted, { result: "none", reason: "unlisted" }, "squeal");

    expect(text).toContain(
      `revision 4 is not listed: remote cmd:lan-1 unreachable since ${SINCE} (missing pnpm); nothing runs here in its place (whenLost "not-run"); it is listed once the remote is ready`,
    );
    expect(timeoutText(plain, { result: "none", reason: "unlisted" }, "squeal")).toContain(
      "revision 4 is not listed yet",
    );
    expect(namedText(unlisted, NOW).split("\n")[1]).toContain(
      `\`squeal status --wait 60000 ${U}\` waits for the listing and the result.`,
    );
  });

  it("stays byte-identical with no outage, a healthy remote, whenLost local, or current files", async () => {
    const w = worktree();
    const base = await timedOut(w.root, [U]);
    const lapsed = timeoutText(base.wait, { result: "none", reason: "lapsed" }, "squeal");
    expect(lapsed).toBe(
      "the daemon's heartbeat had lapsed at the last read; results are as of revision 4",
    );

    // Under whenLost "local" the lane runs the files here: no outage holds them.
    writeRemoteSummary(w.store, w.id as never, UNREACHABLE_SUMMARY);
    note(
      w.store,
      w.id,
      `remote cmd:lan-1 unreachable since ${SINCE} (the host ended); running here`,
    );
    expect((await timedOut(w.root, [U])).text).toBe(base.text);

    // A remote awake again ends the outage its older notes and reasons record.
    note(w.store, w.id, UNREACHABLE_NOTE);
    writeRemoteSummary(
      w.store,
      w.id as never,
      "command cmd:lan-1: awake; background and edit runs of vitest; planning remote; environment match-local",
    );
    const awake = await timedOut(w.root, [U]);
    expect(awake.text).toBe(base.text);
    expect(timeoutText(awake.wait, { result: "none", reason: "lapsed" }, "squeal")).toBe(lapsed);

    // A current file: no line even while the remote is down.
    writeRemoteSummary(w.store, w.id as never, UNREACHABLE_SUMMARY);
    const current = await timedOut(w.root, [C]);
    expect(current.text).not.toContain("Remote:");
  });
});

describe("the recorded evidence (row 026-31)", () => {
  it("never makes an outage from a summary alone, nor from notes with no summary", () => {
    expect(outageOf({ summary: UNREACHABLE_SUMMARY, notes: [], reasons: [] })).toBeNull();
    const notes = [
      { at: NOW as EpochMs, revision: null, text: UNREACHABLE_NOTE, topic: "remote-lane" },
    ];
    expect(outageOf({ notes, reasons: [] })).toBeNull();
    expect(outageOf({ summary: UNREACHABLE_SUMMARY, notes, reasons: [] })).toEqual({
      remote: "cmd:lan-1",
      state: "unreachable",
      reason: "the host ended",
      since: SINCE,
    });
  });

  it("ends with a summary that says the remote is healthy, whatever older reasons record", () => {
    const awake =
      "command cmd:lan-1: awake; background and edit runs of vitest; planning remote; environment match-local";
    expect(outageOf({ summary: awake, notes: [], reasons: [REFUSED_RUN] })).toBeNull();
    expect(
      outageOf({ summary: awake, notes: [], listingFailed: MISSING_PNPM, reasons: [] }),
    ).toBeNull();
    expect(outageOf({ notes: [], listingFailed: MISSING_PNPM, reasons: [] })?.reason).toBe(
      "missing pnpm",
    );
  });

  it("reads a run's and a listing's recorded failures, and only under whenLost not-run", () => {
    expect(reasonOutage(REFUSED_RUN)).toEqual({
      remote: "cmd:lan-1",
      state: "refused",
      reason: "degraded disk: 12 MB/s",
      since: null,
    });
    expect(reasonOutage('remote cmd:lan-1 unreachable; not run here (whenLost "not-run")')).toEqual(
      {
        remote: "cmd:lan-1",
        state: "unreachable",
        reason: null,
        since: null,
      },
    );
    expect(reasonOutage(MISSING_PNPM)).toEqual({
      remote: "cmd:lan-1",
      state: "unreachable",
      reason: "missing pnpm",
      since: SINCE,
    });
    expect(
      reasonOutage('remote cmd:lan-1 refused: HTTP 409; not planned here (whenLost "not-run")'),
    ).toEqual({ remote: "cmd:lan-1", state: "refused", reason: "HTTP 409", since: null });
    expect(reasonOutage("timed out after 600 s")).toBeNull();
  });
});

describe("proof names the recorded remote outage on an unknown side (row 026-31)", () => {
  it("the commit daemon's outage explains a file it does not list or could not key; never a pass", () => {
    const w = worktree();
    const blocked = [
      { ref: ref("src/new.test.ts"), why: "no runner lists it at 0123abcde", listing: true },
      {
        ref: ref(U),
        why: "its commit daemon could not key it (a runner call failed there)",
        listing: false,
      },
    ];
    // Nothing recorded: the texts are as before.
    expect(blockedTexts(w.store, w.id as never, blocked)).toEqual(blocked.map((b) => b.why));
    expect(blockedTexts(null, w.id as never, blocked)).toEqual(blocked.map((b) => b.why));

    writeRemoteSummary(w.store, w.id as never, REFUSED_SUMMARY);
    note(w.store, w.id, "remote cmd:lan-1 refused: degraded disk: 12 MB/s; 2 files not run");
    const [listed, keyed] = blockedTexts(w.store, w.id as never, blocked);

    // The worktree lists its files (a key is stored): a missing row is no outage's.
    expect(listed).toBe("no runner lists it at 0123abcde");
    expect(keyed).toBe(
      "its commit daemon could not key it (a runner call failed there): " +
        'remote cmd:lan-1 refused (degraded disk: 12 MB/s); nothing runs here in its place (whenLost "not-run"); ' +
        "the side stays unknown; run the proof again once the remote is ready",
    );

    // A commit daemon that keyed nothing: the missing row is the outage's too.
    const { repo, store } = repoWith([], []);
    writeRemoteSummary(store, repo.mainId as never, UNREACHABLE_SUMMARY);
    note(store, repo.mainId, UNREACHABLE_NOTE);
    expect(blockedTexts(store, repo.mainId as never, blocked.slice(0, 1))).toEqual([
      `no runner lists it at 0123abcde: remote cmd:lan-1 unreachable since ${SINCE} (the host ended); ` +
        'nothing runs here in its place (whenLost "not-run"); the side stays unknown; run the proof again once the remote is ready',
    ]);
  });

  it("a temporary checkout's detail that records a remote outage names its policy and recovery", () => {
    expect(sideOutageText(MISSING_PNPM)).toBe(
      `${MISSING_PNPM}; the side stays unknown; run the proof again once the remote is ready`,
    );
    expect(sideOutageText("no runner lists it at 0123abcde")).toBe(
      "no runner lists it at 0123abcde",
    );
    expect(sideOutageText("not run (not needed)")).toBe("not run (not needed)");
  });
});
