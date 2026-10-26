import { describe, expect, it } from "vitest";
import {
  acknowledgeLint,
  readLintNews,
  registerLint,
  tellLint,
} from "../../../src/core/lint/surface/deliver.js";
import { after, consumer, lintRig, said } from "./helpers.js";

/* Spec 017 D8: a consumer's lint news, read from the store the real pass writes. */

describe("lint news for one consumer (017 D8)", () => {
  it("seeds by count, tells a changed finding once it is read and acknowledged, then is silent", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" });
    const me = consumer(rig.tree);
    // The first pass found `a` failing before the session: the registration counts it.
    expect(registerLint(rig.source, me, 2_000)).toEqual({ v: 1, failing: 1, stale: 0 });
    const since = after(1);
    expect(tellLint(rig.source, me, 2_001, () => since)).toBeNull();

    // The session's edit adds a finding to `a`.
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
    await rig.revise();
    const read = readLintNews(rig.source, me, 2_100, () => since);
    expect(read?.news?.entries.map(said)).toEqual(["fail-changed src/a.js +no-console"]);
    expect(read?.news).toMatchObject({ v: 1, more: 0, entries: [{ findings: 2, revision: 2 }] });
    // Read only: until acknowledged, it is still news.
    expect(readLintNews(rig.source, me, 2_101, () => since)?.news?.entries).toHaveLength(1);
    acknowledgeLint(rig.source, me, read?.ack ?? expect.unreachable());
    expect(readLintNews(rig.source, me, 2_102, () => since)).toEqual({ news: null, ack: null });
    expect(tellLint(rig.source, me, 2_103, () => since)).toBeNull();
  });
});
