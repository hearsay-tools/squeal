import { describe, expect, it } from "vitest";
import {
  classify,
  ignoredReason,
  inputsFor,
  joinParts,
  keptObservations,
  provenPart,
  runInputsOf,
  splitProof,
  stayedReason,
  unsyncableReason,
} from "../../../src/core/runner-host/remote/lane-proof.js";
import type { RemoteRecord } from "../../../src/core/runner-host/remote/tree-wire.js";
import type { ObservedInputs, RunReport } from "../../../src/core/types/runner.js";

/*
 * Row 026-24 (gh-280; spec 021 D10, D11): a remote run's blob proof, file by
 * file. A differing path taints only the files that hold it; a config path,
 * or one no file holds, taints every file; a path that exists here but is
 * git-ignored is never sent, so a retry cannot repair it.
 */

const A = { project: "", path: "test/a.test.ts" };
const B = { project: "", path: "test/b.test.ts" };
const C = { project: "", path: "test/c.test.ts" };
const FILES = [A, B, C];

const inputs = runInputsOf(
  FILES,
  [
    ["test/a.test.ts", "src/shared.ts"],
    ["test/b.test.ts", "src/shared.ts", "dist/hsq.js"],
    ["test/c.test.ts", "src/c.ts"],
  ],
  ["vitest.config.ts"],
);

const seen = (testFile: typeof A, paths: string[]): ObservedInputs => ({
  testFile,
  paths,
  directories: [],
});

describe("a remote run's inputs, file by file (row 026-24)", () => {
  it("keeps the configs, each file's closure and every path once", () => {
    expect([...inputs.configs]).toEqual(["vitest.config.ts"]);
    expect([...(inputs.byFile.get("\0test/b.test.ts") ?? [])]).toEqual([
      "test/b.test.ts",
      "src/shared.ts",
      "dist/hsq.js",
    ]);
    expect(inputs.all).toEqual([
      "test/a.test.ts",
      "src/shared.ts",
      "test/b.test.ts",
      "dist/hsq.js",
      "test/c.test.ts",
      "src/c.ts",
      "vitest.config.ts",
    ]);
  });

  it("proves for a subset of files only their closures and the configs", () => {
    expect(inputsFor(inputs, [A, C]).sort()).toEqual(
      ["src/c.ts", "src/shared.ts", "test/a.test.ts", "test/c.test.ts", "vitest.config.ts"].sort(),
    );
  });
});

describe("a differing path by the sync boundary (021 D10)", () => {
  it("is unsyncable when it exists here and Git ignores it, else syncable, deleted here too", () => {
    const kinds = classify(["dist/index.html", "src/a.ts", "src/gone.ts"], new Set(["src/a.ts"]), {
      "dist/index.html": "b1",
      "src/a.ts": "b2",
      "src/gone.ts": null,
    });
    expect(kinds).toEqual({
      syncable: ["src/a.ts", "src/gone.ts"],
      unsyncable: ["dist/index.html"],
    });
  });
});

describe("a path only the remote has (row 026-38)", () => {
  it("is unsyncable when it is deleted here and no sync wrote it there; synced, a resend repairs it", () => {
    const kinds = classify(
      ["made.json", "gone.json", "src/a.ts"],
      new Set(["src/a.ts"]),
      { "made.json": null, "gone.json": null, "src/a.ts": "b2" },
      new Set(["made.json"]),
    );
    expect(kinds).toEqual({
      syncable: ["gone.json", "src/a.ts"],
      unsyncable: ["made.json"],
      remoteOnly: ["made.json"],
    });
  });

  it("names each kind with its own way out", () => {
    expect(unsyncableReason(["dist/x", "made.json"], new Set(["made.json"]))).toBe(
      "git-ignored input dist/x exists locally and is not synced to remote; input made.json exists only on the remote, where no sync wrote it, so a resend cannot remove it; declare it in runtimeFiles when it is runtime state, or list its test files in remote.alwaysLocal",
    );
  });
});

describe("the observed paths a proof weighs: those the key keeps (row 026-38)", () => {
  it("asks the key's owner for each observation's differing paths alone", async () => {
    const asked: string[][] = [];
    const kept = await keptObservations(
      [seen(A, [".ai/env.json", "src/x.ts", "same.ts"]), seen(B, ["same.ts"])],
      [".ai/env.json", "src/x.ts"],
      async (o) => {
        asked.push([...o.paths]);
        return o.paths.filter((path) => path !== ".ai/env.json");
      },
    );
    expect(kept.map((o) => o.paths)).toEqual([["src/x.ts"], []]);
    // An observation with no differing path asks nothing.
    expect(asked).toEqual([[".ai/env.json", "src/x.ts"]]);
  });

  it("weighs every differing observed path without an owner, as before row 026-38", async () => {
    const kept = await keptObservations([seen(A, ["out/shot.png", "same.ts"])], ["out/shot.png"]);
    expect(kept.map((o) => o.paths)).toEqual([["out/shot.png"]]);
  });
});

describe("which files a differing path taints", () => {
  const none = { syncable: [], unsyncable: [] };

  it("proves every file when nothing differs", () => {
    expect(splitProof(FILES, inputs, undefined, none)).toEqual({
      proven: FILES,
      unsyncable: [],
      retry: [],
      ignored: [],
    });
  });

  it("taints only the file that observed an ignored path", () => {
    const split = splitProof(FILES, inputs, [seen(B, ["dist/index.html"])], {
      syncable: [],
      unsyncable: ["dist/index.html"],
    });
    expect(split).toEqual({
      proven: [A, C],
      unsyncable: [B],
      retry: [],
      ignored: ["dist/index.html"],
    });
  });

  it("taints only the file whose closure holds an ignored path", () => {
    const split = splitProof(FILES, inputs, undefined, {
      syncable: [],
      unsyncable: ["dist/hsq.js"],
    });
    expect(split.unsyncable).toEqual([B]);
    expect(split.proven).toEqual([A, C]);
  });

  it("retries only the files a syncable path taints; an ignored one wins over it", () => {
    const split = splitProof(FILES, inputs, undefined, {
      syncable: ["src/shared.ts"],
      unsyncable: ["dist/hsq.js"],
    });
    expect(split).toEqual({ proven: [C], unsyncable: [B], retry: [A], ignored: ["dist/hsq.js"] });
  });

  it("fails closed: a config path taints every file", () => {
    expect(
      splitProof(FILES, inputs, undefined, { syncable: ["vitest.config.ts"], unsyncable: [] }),
    ).toMatchObject({ proven: [], retry: FILES });
    expect(
      splitProof(FILES, inputs, undefined, { syncable: [], unsyncable: ["vitest.config.ts"] }),
    ).toMatchObject({ proven: [], unsyncable: FILES, retry: [] });
  });

  it("fails closed: a path no file holds taints every file", () => {
    const other = { project: "", path: "test/z.test.ts" };
    const split = splitProof(FILES, inputs, [seen(other, ["dist/x.html"])], {
      syncable: [],
      unsyncable: ["dist/x.html"],
    });
    expect(split).toMatchObject({ proven: [], unsyncable: FILES });
    expect(
      splitProof(FILES, inputs, undefined, { syncable: ["src/nowhere.ts"], unsyncable: [] }),
    ).toMatchObject({ proven: [], retry: FILES });
  });

  it("weighs only the remaining files: a path held by a file no longer run taints all", () => {
    const split = splitProof([A, C], inputs, undefined, {
      syncable: [],
      unsyncable: ["dist/hsq.js"],
    });
    expect(split.unsyncable).toEqual([A, C]);
  });
});

describe("a refusal's reason", () => {
  it("names the git-ignored inputs, up to five", () => {
    expect(ignoredReason(["dist/index.html"])).toBe(
      "git-ignored input dist/index.html exists locally and is not synced to remote",
    );
    expect(ignoredReason(["1", "2", "3", "4", "5", "6"])).toBe(
      "git-ignored input 1, 2, 3, 4, 5 exists locally and is not synced to remote",
    );
  });

  it("keeps the wording of a tree that stayed different", () => {
    expect(stayedReason(["src/a.ts"])).toBe("its tree stayed different at src/a.ts");
  });
});

describe("the proven part of a remote run", () => {
  const record = (testFile: typeof A): RemoteRecord => ({ testFile, record: testFile.path });
  const report = (files: (typeof A)[]): RunReport => ({
    end: "completed",
    durationMs: 1,
    completedFiles: files,
    results: [],
    fileErrors: [],
    failure: null,
    observed: files.map((f) => seen(f, [])),
  });

  it("drops the unproved files' results and coverage records", () => {
    const part = provenPart(report(FILES), FILES.map(record), [B]);
    expect(part.report.completedFiles).toEqual([A, C]);
    expect(part.report.observed?.map((o) => o.testFile)).toEqual([A, C]);
    expect(part.coverage.map((r) => r.testFile)).toEqual([A, C]);
  });

  it("joins the attempts' parts as one report and their records", () => {
    expect(joinParts([], "remote box")).toBeNull();
    const first = provenPart(report([A, B]), [record(A)], [B]);
    const second = provenPart(report([B]), [record(B)], []);
    expect(joinParts([first], "remote box")).toBe(first);
    const joined = joinParts([first, second], "remote box");
    expect(joined?.report.completedFiles).toEqual([A, B]);
    expect(joined?.report.failure).toBeNull();
    expect(joined?.coverage.map((r) => r.testFile)).toEqual([A, B]);
  });
});
