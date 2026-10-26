import { describe, expect, it } from "vitest";
import { judgeResult, resultOf } from "../../../src/core/lint/pass/judge.js";
import type { LintStore } from "../../../src/core/lint/store/types.js";
import {
  acknowledgeLint,
  readLintNews,
  registerLint,
  tellLint,
} from "../../../src/core/lint/surface/deliver.js";
import type { LintStoreSource } from "../../../src/core/lint/surface/source.js";
import { toldKey } from "../../../src/core/lint/surface/told.js";
import { finding } from "../helpers.js";
import { consumer, lintRig, ownAfter, said } from "./helpers.js";

/*
 * Wave 2 rule 2: an edit between two steps. The pass's clock in these
 * tests runs from 1,000 and every delivery's from 5,000, so each change it
 * records looks older than the delivery that missed it: a mark kept as a
 * clock would lose it.
 */

describe("lint news across an edit between two steps (017 D8, wave 2 rule 2)", () => {
  it("keeps a change the pass records between a read and its acknowledgement", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    const since = () => ownAfter(1);

    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
    await rig.revise();
    const read = readLintNews(rig.source, me, 5_100, since);
    expect(read?.news?.entries.map(said)).toEqual(["fail-changed src/a.js +no-console"]);

    // Before the caller acknowledges, the next edit lands, and then the fix.
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\nbad no-alert\n");
    await rig.revise();
    acknowledgeLint(rig.source, me, read?.ack ?? expect.unreachable());
    expect(tellLint(rig.source, me, 5_200, since)?.entries.map(said)).toEqual([
      "fail-changed src/a.js +no-alert",
    ]);

    // The same with a fix: the PASS after the read is not lost.
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    const second = readLintNews(rig.source, me, 5_300, since);
    expect(second?.news?.entries.map(said)).toEqual([
      "fail-changed src/a.js -no-console -no-alert",
    ]);
    rig.tree.write("src/a.js", "ok\n");
    await rig.revise();
    acknowledgeLint(rig.source, me, second?.ack ?? expect.unreachable());
    expect(tellLint(rig.source, me, 5_400, since)?.entries.map(said)).toEqual([
      "fail-to-pass src/a.js -no-undef",
    ]);
    expect(tellLint(rig.source, me, 5_500, since)).toBeNull();
  });

  it("acknowledged newest then oldest, keeps the newer view and mark: nothing lost or told twice", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    const since = () => ownAfter(1);
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
    await rig.revise();
    const older = readLintNews(rig.source, me, 5_100, since);
    expect(older?.news?.entries.map(said)).toEqual(["fail-changed src/a.js +no-console"]);
    rig.tree.write("src/a.js", "bad no-undef\nbad no-alert\n");
    await rig.revise();
    const newer = readLintNews(rig.source, me, 5_200, since);
    expect(newer?.news?.entries.map(said)).toEqual(["fail-changed src/a.js +no-alert"]);

    acknowledgeLint(rig.source, me, newer?.ack ?? expect.unreachable());
    const told = () => [rig.store.views.list(me), rig.store.meta.get(toldKey(me))];
    const afterNewer = told();
    acknowledgeLint(rig.source, me, older?.ack ?? expect.unreachable());
    expect(told()).toEqual(afterNewer);
    expect(tellLint(rig.source, me, 5_300, since)).toBeNull();
    // Back to the bytes the older read saw: had its view been written, this would read as no change.
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_400, since)?.entries.map(said)).toEqual([
      "fail-changed src/a.js +no-console -no-alert",
    ]);
    expect(tellLint(rig.source, me, 5_500, since)).toBeNull();
  });

  it("acknowledged oldest then newest, writes the older only, and still owes the newer change", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n", "src/b.js": "ok\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    const since = () => ownAfter(1);
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    const older = readLintNews(rig.source, me, 5_100, since);
    rig.tree.write("src/b.js", "bad no-console\n");
    await rig.revise();
    const newer = readLintNews(rig.source, me, 5_200, since);
    acknowledgeLint(rig.source, me, older?.ack ?? expect.unreachable());
    // The newer read started from a mark that is gone: it writes nothing.
    acknowledgeLint(rig.source, me, newer?.ack ?? expect.unreachable());
    expect(tellLint(rig.source, me, 5_300, since)?.entries.map(said)).toEqual([
      "pass-to-fail src/b.js +no-console",
    ]);
    expect(tellLint(rig.source, me, 5_400, since)).toBeNull();
  });

  it("tells, in tellLint's write, a change the pass committed after its read-only look", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n", "src/b.js": "ok\n" });
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    // The pass commits `b`'s change, at its own older clock, once the read-only look ends.
    let looks = 0;
    const source: LintStoreSource = {
      policy: () => rig.source.policy(),
      open() {
        const access = rig.source.open();
        if (access === null || access === "missing" || !("store" in access)) return access;
        const { store } = access;
        const read = <T>(fn: () => T): T => {
          const out = store.read(fn);
          if (looks++ === 0) failAs(store, rig.tree.id, "src/b.js", "no-console", 3);
          return out;
        };
        return { ...access, store: { ...store, read } };
      },
    };
    const told = tellLint(source, me, 5_100, () => ownAfter(1));
    expect(looks).toBe(1);
    expect(told?.entries.map(said)).toEqual([
      "pass-to-fail src/a.js +no-undef",
      "pass-to-fail src/b.js +no-console",
    ]);
    expect(tellLint(rig.source, me, 5_200, () => ownAfter(1))).toBeNull();
  });
});

/** What the pass commits when `path` lints with one finding of `rule` at `revision`, at clock 1,000. */
function failAs(
  store: LintStore,
  worktreeId: string,
  path: string,
  rule: string,
  revision: number,
) {
  const prior = store.states.list(worktreeId, { paths: [path] })[0] ?? null;
  const result = resultOf(
    path,
    `key-${revision}`,
    [finding(rule, `${rule} found`)],
    "9.30.0",
    1_000,
  );
  const at = { worktreeId, revision, now: 1_000, cause: "edit" as const };
  const judged = judgeResult(store.results, prior, result, "blob", at);
  store.transaction(() => {
    store.results.put(result, 1_000);
    store.states.upsertMany([judged.state]);
    store.transitions.append(judged.transition === null ? [] : [judged.transition]);
  });
}
