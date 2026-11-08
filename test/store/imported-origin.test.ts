import { describe, expect, it } from "vitest";
import { oneOfOrNull } from "../../src/core/store/codec.js";
import { connectionOf } from "../../src/core/store/store.js";
import { importIdOf, importMark } from "../../src/core/types/state.js";
import { fakeCommonDir, knownState, open, testCheck } from "./helpers.js";

/*
 * Spec 018 D4: an imported origin is stored so that a release before 018,
 * which reads `origin_kind` with `oneOfOrNull` of `own` and `inherited`,
 * reads it as no known origin and never throws; this release reads it back
 * as `imported`, and a kind a later release stores as no known origin.
 */

const check = testCheck("imports");
const imported = { kind: "imported", importId: "0123abcd", commit: "c".repeat(40) } as const;

describe("the imported origin in known_states (018 D4)", () => {
  it("reads back as imported, its kind stored as none and its import as the worktree", () => {
    const store = open(fakeCommonDir());
    store.knownStates.upsertMany([{ ...knownState("wt-a", check), origin: imported }]);
    expect(store.knownStates.get("wt-a", check)?.origin).toEqual(imported);
    const row = connectionOf(store).get(
      "SELECT origin_kind, origin_worktree, origin_commit FROM known_states",
    );
    expect(row).toEqual({
      origin_kind: null,
      origin_worktree: "import:0123abcd",
      origin_commit: imported.commit,
    });
    // The reader of a release before 018.
    const older = row === null ? "absent" : oneOfOrNull(row, "origin_kind", ["own", "inherited"]);
    expect(older).toBeNull();
  });

  it("a kind this release does not know reads as no known origin", () => {
    const store = open(fakeCommonDir());
    store.knownStates.upsertMany([knownState("wt-a", check)]);
    connectionOf(store).run("UPDATE known_states SET origin_kind = 'later-kind'");
    expect(store.knownStates.get("wt-a", check)?.origin).toBeNull();
    expect(store.knownStates.list("wt-a")).toHaveLength(1);
  });

  it("an import mark never reads as a worktree id, nor a worktree id as a mark", () => {
    expect(importIdOf(importMark("0123abcd"))).toBe("0123abcd");
    expect(importIdOf("0123456789abcdef")).toBeNull();
  });
});
