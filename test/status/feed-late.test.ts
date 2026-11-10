import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatRegistration } from "../../src/core/delivery/format.js";
import { headerLines } from "../../src/core/delivery/header.js";
import { readLiveHeader } from "../../src/core/delivery/liveness.js";
import { FeedDeliveredRow } from "../../src/core/presence/events.js";
import { feedDeliveredMetaKey, readFeedDelivered } from "../../src/core/presence/stored.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { readStatus } from "../../src/core/status/snapshot.js";
import { timeText } from "../../src/core/text.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { refinedMetaKey } from "../../src/core/types/scheduler.js";
import type { Store } from "../../src/core/types/store.js";
import type { DaemonRecord } from "../../src/core/types/store-records.js";
import { statusText } from "../../src/harness/shared/text.js";
import { fixedStatus } from "../delivery/fakes.js";
import { appendRevisions, check, type FakeRepo, fakeRepo, seedStore, state } from "./helpers.js";

/*
 * Row 011-200 (C6, C8; the human, 2026-10-25): while the last batch the live daemon's change feed
 * delivered started more than 60 s ago, status, Stop and the hook headers say that Squeal has not
 * read the edits made since, and which revision the counts cover (worded by row 011-311). A feed
 * on time changes no byte of them.
 */

const NOW = Date.UTC(2026, 9, 25, 1, 5, 0);
const HEAD = 23;

const LIVE: DaemonRecord = {
  socketPath: "/tmp/squeal-feed-late.sock",
  startedAt: NOW - 30 * 60_000,
  heartbeatAt: NOW - 1_000,
  heartbeatIntervalMs: 5_000,
  squealVersion: "0.0.0-test",
  token: "live",
};

interface Seeded {
  readonly repo: FakeRepo;
  readonly store: Store;
  readonly wt: string;
}

/** A worktree at revision 23 with two current test files, its daemon `daemon`. */
function worktree(daemon: DaemonRecord | null = LIVE): Seeded {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const wt = repo.mainId;
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon,
  });
  appendRevisions(store, wt, HEAD, { head: null, dirty: true });
  store.meta.set(refinedMetaKey(wt), String(HEAD));
  for (const path of ["test/a.test.ts", "test/b.test.ts"]) {
    store.testFileKeys.upsertMany([
      {
        worktreeId: wt,
        testFile: { project: "", path: path as never },
        key: `k-${path}` as CheckKey,
        revision: HEAD,
        pending: null,
      },
    ]);
    store.knownStates.upsertMany([state(wt, check(path, "t"), { observedAt: HEAD })]);
  }
  return { repo, store, wt };
}

const delivered = ({ store, wt }: Seeded, at: number) =>
  store.meta.set(feedDeliveredMetaKey(wt), String(at));

/** Every output 011-200 qualifies: status, its JSON liveness, registration, Stop and news. */
async function outputs(w: Seeded) {
  const { repo, store, wt } = w;
  const status = readStatus(repo.main, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  const consumer: Consumer = { worktreeId: wt, sessionId: "s1", agentId: "main" };
  const delivery = createDelivery(store, { status: fixedStatus(), now: () => NOW });
  const header = readLiveHeader(store, wt, NOW);
  return {
    status: formatStatus(status, NOW),
    daemon: status.daemon,
    registration: formatRegistration(await delivery.register(consumer), undefined, "squeal", NOW),
    stop: statusText(header, []),
    news: headerLines(header, "squeal", "news").join("\n"),
  };
}

describe("a late change feed is said (011-200)", () => {
  it("a held feed: status, Stop, the registration and a news header name the lag", async () => {
    const w = worktree();
    const since = NOW - FEED_LATE_MS - 1_000;
    delivered(w, since);
    const out = await outputs(w);
    // Row 011-311: the human's words, and no "current" for the revision the counts cover.
    const sentence = `Squeal has not yet read edits made after ${timeText(since)}; these counts cover revision ${HEAD} and earlier.`;
    expect(out.status.split("\n")[1]).toBe(sentence);
    expect(out.status).toContain("Known failures: 0; 2 test files current\n");
    expect(out.daemon).toEqual({
      state: "alive",
      lastHeartbeatAt: LIVE.heartbeatAt,
      late: { since },
    });
    expect(out.stop).toContain(` ${sentence}`);
    expect(out.registration).toContain(` ${sentence}`);
    expect(out.news).toBe(
      `Revision ${HEAD} (changed src/a.ts): no check pending, stale or unknown. ${sentence}`,
    );
  });

  it("a feed on time changes no byte of any output", async () => {
    const before = await outputs(worktree());
    for (const age of [0, 15_000, FEED_LATE_MS]) {
      const w = worktree();
      delivered(w, NOW - age);
      expect(await outputs(w)).toEqual(before);
    }
    expect(before.status).toContain("Known failures: 0; all 2 test files current\n");
  });

  it("a time stored before the live daemon started is its predecessor's: nothing is said", async () => {
    const before = await outputs(worktree());
    const w = worktree();
    delivered(w, LIVE.startedAt - 1);
    expect(await outputs(w)).toEqual(before);
  });

  it("with no live daemon the down sentence stands alone", async () => {
    const down = { ...LIVE, heartbeatAt: NOW - 60 * 60_000 };
    const before = await outputs(worktree(down));
    const w = worktree(down);
    delivered(w, NOW - 40 * 60_000);
    expect(await outputs(w)).toEqual(before);
  });
});

/*
 * Row 011-311 (the human, 2026-11-10): a cezar hook message named both delays in two sentences,
 * "The runner part of revision 5 is pending; test files it adds are not counted yet. Edits since
 * 00:29:56 may not be seen yet; results are current as of revision 5.", and read as contradictory.
 * Each output now says both in one sentence that names the project's runner, and says it once.
 */
describe("a late feed and an unlisted revision are one sentence (011-311)", () => {
  const behind = (since: number, runners: string) =>
    `Squeal is behind: it has not read edits made after ${timeText(since)}, and ${runners} not listed revision ${HEAD}'s test files yet, so new test files are not counted.`;
  const unlisted = (w: Seeded) => w.store.meta.set(refinedMetaKey(w.wt), String(HEAD - 1));
  const occurrences = (text: string, part: string) => text.split(part).length - 1;

  it("status, Stop, the registration and a news header say both delays once", async () => {
    const w = worktree();
    const since = NOW - FEED_LATE_MS - 1_000;
    delivered(w, since);
    unlisted(w);
    const out = await outputs(w);
    const sentence = behind(since, "Vitest has");
    expect(out.status.split("\n")[1]).toBe(sentence);
    for (const text of [out.status, out.stop, out.registration, out.news]) {
      expect(occurrences(text, sentence)).toBe(1);
      expect(text).not.toMatch(/runner part|may not be seen|current as of revision/);
    }
    expect(out.news).toBe(
      `Revision ${HEAD} (changed src/a.ts): no check pending, stale or unknown. ${sentence}`,
    );
  });

  it("names the project's runners: pytest alone, then beside Vitest", async () => {
    const since = NOW - FEED_LATE_MS - 1_000;
    const pytest = { pytest: [{ name: "unit", include: ["tests/**/test_*.py"] }] };
    const cases = [
      [pytest, null, "pytest has"],
      [pytest, { devDependencies: { vitest: "^3.0.0" } }, "Vitest and pytest have"],
    ] as const;
    for (const [config, manifest, runners] of cases) {
      const w = worktree();
      writeFileSync(join(w.repo.main, "squeal.config.json"), JSON.stringify(config));
      if (manifest !== null) {
        writeFileSync(join(w.repo.main, "package.json"), JSON.stringify(manifest));
      }
      delivered(w, since);
      unlisted(w);
      const out = await outputs(w);
      for (const text of [out.status, out.stop, out.registration, out.news]) {
        expect(occurrences(text, behind(since, runners))).toBe(1);
      }
    }
  });

  it("each delay alone has its own sentence", async () => {
    const since = NOW - FEED_LATE_MS - 1_000;
    const late = worktree();
    delivered(late, since);
    const lateOut = await outputs(late);
    const lateSentence = `Squeal has not yet read edits made after ${timeText(since)}; these counts cover revision ${HEAD} and earlier.`;
    expect(lateOut.status.split("\n")[1]).toBe(lateSentence);
    expect(lateOut.news).toBe(
      `Revision ${HEAD} (changed src/a.ts): no check pending, stale or unknown. ${lateSentence}`,
    );
    const listing = worktree();
    unlisted(listing);
    const listingOut = await outputs(listing);
    const listingSentence = `Vitest has not yet listed the test files of revision ${HEAD}, so new test files are not counted.`;
    expect(listingOut.status.split("\n")[1]).toBe(listingSentence);
    for (const [out, sentence] of [
      [lateOut, lateSentence],
      [listingOut, listingSentence],
    ] as const) {
      for (const text of [out.status, out.stop, out.registration, out.news]) {
        expect(occurrences(text, sentence)).toBe(1);
        expect(text).not.toMatch(/runner part|may not be seen|current as of revision/);
      }
    }
  });
});

describe("the daemon's row of the feed's last delivery (011-200)", () => {
  it("moves only once the stored time is 15 s old", () => {
    const w = worktree();
    const row = new FeedDeliveredRow(w.store, w.wt, (error) => {
      throw error;
    });
    const writes: number[] = [];
    const set = w.store.meta.set.bind(w.store.meta);
    w.store.meta.set = (key, value) => {
      writes.push(Number(value));
      set(key, value);
    };
    for (let at = 0; at <= 90_000; at += 5_000) row.record(NOW + at);
    expect(writes).toEqual([0, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000].map((t) => NOW + t));
    expect(readFeedDelivered(w.store, w.wt)).toBe(NOW + 90_000);
  });

  it("skips a busy store, and reports any other failure once until a write lands", () => {
    const w = worktree();
    const errors: Error[] = [];
    const row = new FeedDeliveredRow(w.store, w.wt, (error) => errors.push(error));
    const set = w.store.meta.set.bind(w.store.meta);
    let failure: Error | null = Object.assign(new Error("database is locked"), { errcode: 5 });
    w.store.meta.set = (key, value) => {
      if (failure !== null) throw failure;
      set(key, value);
    };
    row.record(NOW);
    expect(errors).toEqual([]);
    expect(readFeedDelivered(w.store, w.wt)).toBeNull();
    failure = new Error("disk I/O error");
    row.record(NOW + 1_000);
    row.record(NOW + 2_000);
    expect(errors.map(String)).toEqual([
      "Error: could not store the change feed's last delivery: Error: disk I/O error",
    ]);
    failure = null;
    row.record(NOW + 3_000);
    expect(readFeedDelivered(w.store, w.wt)).toBe(NOW + 3_000);
  });
});
