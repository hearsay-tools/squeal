import { describe, expect, it, vi } from "vitest";
import { namedPicker, readNamedLint } from "../../src/cli/wait/named-lint.js";
import type { LintStore } from "../../src/core/lint/store/types.js";
import type { AbsolutePath, EpochMs, RevisionNumber } from "../../src/core/types/common.js";
import { keyedAt, lintedRepo, stateOf } from "./named-lint-fixture.js";
import { B, NOW } from "./status-wait-fixture.js";

/*
 * Review 0.1.666-r2 B1-R (row 017-37): the named lint read takes the states,
 * the cursor and the facts beside them from one snapshot of the lint
 * store. Two real connections to one WAL store: the reader's state list
 * returns the old pass, then a writer commits B `pending` with the cursor
 * at revision 4 in one transaction, then the reader reads the cursor. The
 * result must be pending, never the old pass certified by the new cursor.
 */

/** Runs once after the reader's next state list of a tool returns, before its next statement. */
const hook = vi.hoisted(() => ({ afterList: null as null | (() => void) }));

vi.mock("../../src/core/lint/store/open.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/lint/store/open.js")>();
  return {
    ...actual,
    openLintStore: (...args: Parameters<typeof actual.openLintStore>) => {
      const store = actual.openLintStore(...args);
      if (actual.isLintStoreOpenFailure(store)) return store;
      const list = store.states.list.bind(store.states);
      (store.states as { list: LintStore["states"]["list"] }).list = (id, filter) => {
        const rows = list(id, filter);
        const after = hook.afterList;
        if (after !== null && filter?.tool === "eslint") {
          hook.afterList = null;
          after();
        }
        return rows;
      };
      return store;
    },
  };
});

describe("the named lint read is one snapshot (review 0.1.666-r2 B1-R)", () => {
  it("gives pending when a writer stores pending and cursor 4 between the state list and the cursor read", () => {
    const { repo, lint: writer } = lintedRepo("pass");
    // The old pass at B's bytes now, and the pass keyed at revision 3 under the old config.
    writer.states.upsertMany([stateOf(repo.mainId, B, "pass")]);
    keyedAt(writer, repo.mainId, 3, "old-config");
    hook.afterList = () =>
      writer.transaction(() => {
        writer.states.upsertMany([stateOf(repo.mainId, B, "pending")]);
        keyedAt(writer, repo.mainId, 4, "new-config");
      });
    const root = repo.main as AbsolutePath;
    const named = namedPicker(root, root, [B]);
    const got = readNamedLint(
      root,
      repo.commonDir as AbsolutePath,
      named,
      4 as RevisionNumber,
      NOW as EpochMs,
      1_000,
    );
    expect(hook.afterList).toBeNull();
    expect(got.lint).toMatchObject({ done: 0, pending: 1 });
    expect(got.lint?.files).toEqual([
      {
        path: B,
        tool: "eslint",
        outcome: "pending",
        waits: "keying",
        reason: "lint has not keyed revision 4 yet (last keyed at revision 3)",
      },
    ]);
    // The next read sees the writer's snapshot: B pending as an edited file, keyed at 4.
    const next = readNamedLint(
      root,
      repo.commonDir as AbsolutePath,
      named,
      4 as RevisionNumber,
      NOW as EpochMs,
      1_000,
    );
    expect(next.lint?.files[0]).toMatchObject({ outcome: "pending", waits: "linting" });
  });
});
