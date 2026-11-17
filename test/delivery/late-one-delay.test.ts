import { beforeEach, describe, expect, it } from "vitest";
import { feedDeliveredMetaKey } from "../../src/core/presence/stored.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import { FILE, WT } from "../state/helpers.js";
import {
  boundary,
  C1,
  clock,
  delivery,
  edit,
  key,
  OTHER_FILE,
  setUp,
  store,
  tick,
} from "./late-fixture.js";

/*
 * Row 005-114, review 0.1.554: a consumer registered before the listing is owed the counts
 * (row 011-205); its first boundary after the listing may also carry the late line. The late
 * line owns the delay sentence there too, so the whole message says the delay and the path wait
 * once.
 */

const LATE_TITLE =
  /^SQUEAL · results for your edits are late; first results in this worktree at revision 1$/m;
const DELAY_LISTED = /not (?:yet )?listed/g;
const DELAY_READ = /not (?:yet )?read edits/g;
const PATH_WAIT = /status --wait 60000/g;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

beforeEach(() => setUp());

/** Registered before the listing; the listing lands; an edit stays unlisted for 61 s. */
async function owedThenUnlisted(): Promise<void> {
  store.testFileKeys.remove(WT, [FILE, OTHER_FILE]);
  await delivery.register(C1);
  key(FILE, "k1");
  key(OTHER_FILE, "b1");
  recordRefinedApplied(store, WT, 0);
  edit(["src/a.ts"], false);
  tick(61_000);
}

describe("the counts after the listing beside a late line (row 005-114)", () => {
  it("says the unlisted delay and the path wait once", async () => {
    await owedThenUnlisted();
    const said = (await boundary()) ?? "";
    expect(said).toMatch(LATE_TITLE);
    expect(said).toContain("test files are current");
    expect(count(said, DELAY_LISTED)).toBe(1);
    expect(count(said, PATH_WAIT)).toBe(1);
  });

  it("with a late feed, says the unread delay and the path wait once", async () => {
    await owedThenUnlisted();
    store.meta.set(feedDeliveredMetaKey(WT), String(clock - FEED_LATE_MS - 1_000));
    const said = (await boundary()) ?? "";
    expect(said).toMatch(LATE_TITLE);
    expect(said).toContain("test files are current");
    expect(count(said, DELAY_READ)).toBe(1);
    expect(count(said, PATH_WAIT)).toBe(1);
  });
});

describe("the test files not listed in the worktree beside a late line (row 005-114)", () => {
  it("says no late line: the header's start sentence carries the one path wait", async () => {
    // Registration said "still starting" and the path wait; a late line would add a second.
    store.testFileKeys.remove(WT, [FILE, OTHER_FILE]);
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["src/a.ts"], false);
    tick(61_000);
    expect(await boundary()).toBeNull();
  });
});
