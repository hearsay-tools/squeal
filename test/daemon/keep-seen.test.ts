import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { partsOf } from "../../src/core/code/gate/keep-sent.js";
import { DaemonWrites } from "../../src/core/daemon/busy-writes.js";
import { keepInDaemon } from "../../src/core/daemon/keep-request.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { observedMetaKey, readSharedEntries } from "../../src/core/keys/observed.js";
import { BusyWaits } from "../../src/core/store/busy.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import { storePaths } from "../../src/core/store/paths.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import type { KeepRequest, SeenReads } from "../../src/core/types/daemon-writes.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";

/*
 * Row 020-48 (spec 020 D17.3, #206): the keep request's `seen` write, the
 * reads of the gate's runs that a serving daemon merges into the shared
 * observed rows. It is checked whole as it is parsed, sent in parts small
 * beside a keep line's limit, and merged in the daemon's retried path,
 * where a busy store answers "not kept" for the gate to try again.
 */

const A: SeenReads = {
  ref: { project: "", path: "test/a.test.ts" },
  add: ["data/table.json"],
  direct: [],
  modules: ["src/a.ts"],
};
const SEEN = { kind: "seen", seen: [A] } as const;
const keepOf = (write: unknown) =>
  JSON.stringify({ type: "keep", id: "try-1", worktreeId: "w1", storeSchema: 7, write });

describe("the keep request's seen write (row 020-48)", () => {
  it("parses whole", () => {
    expect(parseRequest(keepOf(SEEN))).toEqual({
      type: "keep",
      id: "try-1",
      worktreeId: "w1",
      storeSchema: 7,
      write: SEEN,
    });
  });

  it.each([
    [{ ...SEEN, key: "a".repeat(64) }, '"write.key" is not a field of a seen write'],
    [{ kind: "seen", seen: [] }, `"write.seen" must be a list of 1 to 100000 test files' reads`],
    [{ kind: "seen", seen: [{ ...A, extra: 1 }] }, '"write.seen[0]" has the unknown field "extra"'],
    [
      { kind: "seen", seen: [A, { ...A, ref: { project: "" } }] },
      '"write.seen[1]" "ref" must name a project and a test file',
    ],
    [
      { kind: "seen", seen: [{ ...A, add: ["/etc/passwd"] }] },
      '"write.seen[0]" "add" must be a list of relative paths',
    ],
    [
      { kind: "seen", seen: [{ ...A, modules: undefined }] },
      '"write.seen[0]" "modules" must be a list of relative paths',
    ],
    [{ kind: "other" }, '"write.kind" must be "coverage", "results" or "seen"'],
  ])("refuses %j: %s", (write, why) => {
    expect(parseRequest(keepOf(write))).toBe(why);
  });
});

describe("the seen write's parts (row 020-48)", () => {
  const sized = (path: string) => ({ ...A, ref: { project: "", path } });
  const bytes = Buffer.byteLength(JSON.stringify(sized("test/1.test.ts")));

  it("keeps the order, and starts a part where the next file's reads would pass the bound", () => {
    const seen = ["1", "2", "3"].map((n) => sized(`test/${n}.test.ts`));

    expect(partsOf(seen, bytes * 2)).toEqual([[seen[0], seen[1]], [seen[2]]]);
    expect(partsOf(seen)).toEqual([seen]);
    expect(partsOf([])).toEqual([]);
  });

  it("never splits one file's reads, past the bound alone", () => {
    const seen = [sized("test/1.test.ts"), sized("test/2.test.ts")];

    expect(partsOf(seen, 1)).toEqual([[seen[0]], [seen[1]]]);
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the daemon's merge of a seen write (row 020-48)", () => {
  /** A store, the daemon's keep context on it, and the `observed.` row of its root project. */
  function daemonStore() {
    const commonDir = mkdtempSync(join(tmpdir(), "squeal-keep-seen-")) as AbsolutePath;
    dirs.push(commonDir);
    const store = openStore(commonDir);
    if (isStoreOpenFailure(store)) throw new Error(store.reason);
    const writes = new DaemonWrites(new BusyWaits({ now: Date.now, note: () => {} }));
    const context = {
      commonDir,
      worktreeId: "w1" as WorktreeId,
      store,
      policy: () => DEFAULT_POLICY,
      writes,
      now: Date.now,
    };
    const request: KeepRequest = {
      type: "keep",
      id: "try-1",
      worktreeId: "w1" as WorktreeId,
      storeSchema: store.schemaVersion,
      write: SEEN,
    };
    const observed = () => readSharedEntries(store, observedMetaKey(""))[A.ref.path];
    return { commonDir, store, context, request, observed };
  }

  it("merges the reads into the shared observed row", async () => {
    const { store, context, request, observed } = daemonStore();
    try {
      expect(await keepInDaemon(context, request)).toEqual({ kept: true });
      expect(observed()).toEqual(["data/table.json"]);
    } finally {
      store.close();
    }
  });

  it("answers not kept while another connection holds the write lock, and merges nothing", async () => {
    const { commonDir, store, context, request, observed } = daemonStore();
    const holder = new DatabaseSync(storePaths(commonDir).database);
    holder.exec("BEGIN IMMEDIATE");
    try {
      expect(await keepInDaemon(context, request)).toEqual({ kept: false });
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    try {
      expect(observed()).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
