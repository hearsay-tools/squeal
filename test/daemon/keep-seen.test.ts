import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { partsOf, SEEN_BYTES } from "../../src/core/code/gate/keep-sent.js";
import { DaemonWrites } from "../../src/core/daemon/busy-writes.js";
import { keepInDaemon } from "../../src/core/daemon/keep-request.js";
import { parseRequest } from "../../src/core/daemon/protocol.js";
import { compare } from "../../src/core/fs/compare.js";
import { observedModulesMetaKey } from "../../src/core/keys/modules.js";
import {
  observedDirectMetaKey,
  observedMetaKey,
  readSharedEntries,
} from "../../src/core/keys/observed.js";
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

/** The bytes of `part` as the write that sends it. */
const sent = (part: readonly SeenReads[]) =>
  Buffer.byteLength(JSON.stringify({ kind: "seen", seen: part }));

/** `count` paths under `prefix`, in order. */
const paths = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}/${i}/${"x".repeat(40)}`);

/** A test file's reads: `count` paths in each of the three lists. */
const file = (path: string, count = 1): SeenReads => ({
  ref: { project: "", path },
  add: paths("data/add", count),
  direct: paths("data/direct", count),
  modules: paths("src/modules", count),
});

/** Each file's three lists, the entries of `parts` joined in order. */
function joined(parts: readonly (readonly SeenReads[])[]) {
  const out = new Map<string, { add: string[]; direct: string[]; modules: string[] }>();
  for (const entry of parts.flat()) {
    const at = out.get(entry.ref.path) ?? { add: [], direct: [], modules: [] };
    for (const list of ["add", "direct", "modules"] as const) {
      for (const path of entry[list]) at[list].push(path);
    }
    out.set(entry.ref.path, at);
  }
  return [...out];
}

describe("the seen write's parts (row 020-48; review 0.1.465 S1)", () => {
  it("keeps whole files together while the write fits the bound, at the boundary too", () => {
    const seen = ["1", "2", "3"].map((n) => file(`test/${n}.test.ts`));
    const two = sent(seen.slice(0, 2));

    expect(partsOf(seen, two)).toEqual([[seen[0], seen[1]], [seen[2]]]);
    const under = partsOf(seen, two - 1);
    expect(under.map(sent).every((bytes) => bytes <= two - 1)).toBe(true);
    expect(under[0]).not.toEqual([seen[0], seen[1]]);
    expect(joined(under)).toEqual(joined([seen]));
    expect(partsOf(seen)).toEqual([seen]);
    expect(partsOf([])).toEqual([]);
  });

  it("splits a file larger than the bound across entries of its ref, each part within it", () => {
    const big = file("test/big.test.ts", 2_000);
    const seen = [file("test/1.test.ts"), big, file("test/2.test.ts")];
    const bound = Math.floor(sent([big]) / 3);

    const parts = partsOf(seen, bound);

    expect(parts.length).toBeGreaterThan(3);
    expect(Math.max(...parts.map(sent))).toBeLessThanOrEqual(bound);
    expect(joined(parts)).toEqual(joined([seen]));
  });

  it("sends the review's 5.7 MB file in parts within the default 4 MiB", () => {
    const add = Array.from({ length: 50_000 }, (_, i) => `data/${i}/${"x".repeat(100)}`);
    const seen = [{ ref: { project: "", path: "test/a.test.ts" }, add, direct: [], modules: [] }];
    expect(sent(seen)).toBeGreaterThan(SEEN_BYTES);

    const parts = partsOf(seen);

    expect(parts).toHaveLength(2);
    expect(Math.max(...parts.map(sent))).toBeLessThanOrEqual(SEEN_BYTES);
    expect(joined(parts)).toEqual(joined([seen]));
  });

  it("sends one path a part when a path with its file alone passes the bound", () => {
    const seen = [file("test/1.test.ts")];

    const parts = partsOf(seen, 1);

    expect(parts.map((part) => part.flatMap((e) => [...e.add, ...e.direct, ...e.modules]))).toEqual(
      [[seen[0]?.add[0]], [seen[0]?.direct[0]], [seen[0]?.modules[0]]],
    );
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

  it("merges a file's reads split across parts whole into each of the three rows (review 0.1.465 S1)", async () => {
    const { store, context, request } = daemonStore();
    const big = file("test/big.test.ts", 300);
    const parts = partsOf([big], Math.floor(sent([big]) / 4));
    expect(parts.length).toBeGreaterThan(3);
    const rows = [observedMetaKey(""), observedDirectMetaKey(""), observedModulesMetaKey("")];
    try {
      for (const [n, part] of parts.entries()) {
        const write = { kind: "seen", seen: part } as const;
        expect(await keepInDaemon(context, { ...request, id: `try-${n}`, write })).toEqual({
          kept: true,
        });
      }
      const merged = rows.map((key) => readSharedEntries(store, key)[big.ref.path]);
      expect(merged).toEqual(
        [big.add, big.direct, big.modules].map((list) => [...list].sort(compare)),
      );
    } finally {
      store.close();
    }
  });
});
