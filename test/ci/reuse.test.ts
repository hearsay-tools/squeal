import { describe, expect, it, vi } from "vitest";
import { type NamedPart, type Place, reuseRefusal } from "../../src/core/ci/export-check.js";
import { certifier } from "../../src/core/ci/export-inputs.js";
import type { Part } from "../../src/core/ci/parts.js";
import { FileReuse, firstShared, type Holder, type ReuseOptions } from "../../src/core/ci/reuse.js";
import type { WorktreeKeys } from "../../src/core/scheduler/keying.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { GATE as GATE_ENVIRONMENT, partProject, RUNNER } from "../code/gate/parts-fixture.js";
import { blob, collected, EVIDENCE, file, part, REF, unrecorded } from "../code/gate/parts-kit.js";

/*
 * Spec 020 D13.2, 018 D9 (row 020-52): one rule, `FileReuse`, decides for
 * both readers of parts whether a part gives a test file. Each deliberate
 * difference between the gate (`squeal code --base --parts`) and `ci
 * export` has a test here; what both share is pinned by the gate's
 * `parts*.test.ts` and the export's `export*.test.ts`, unchanged.
 */

/** The inputs of `test/a.test.ts`: its closure and what it read. */
const INPUTS = ["src/a.ts", "test/a.test.ts", "data/x.txt"];

/** Each path's content here as the part read it. */
const here = (path: string) => EVIDENCE[path];

/** The gate's option. */
const GATE: ReuseOptions = { records: { changed: ["src/a.ts"], children: false } };

const named = (...parts: Part[]): NamedPart[] =>
  parts.map((p, i) => ({ file: `part-${i}.json`, part: p }));

function holder(reuse: FileReuse, ref: TestFileRef = REF): Holder {
  const owner = reuse.owner(ref);
  if (owner === null || "reason" in owner) throw new Error(`no holder: ${JSON.stringify(owner)}`);
  return owner;
}

describe("FileReuse option records: the gate's, not ci export's (row 020-52)", () => {
  it("a part whose records this Squeal does not read gives no file to the gate, and every file to the export", () => {
    const parts = named(collected("istanbul"));
    const detail = 'its records were collected by "istanbul", which this Squeal does not read';
    const gate = new FileReuse(parts, GATE);
    expect(gate.owner(REF)).toEqual({ part: "part-0.json", reason: "unusable", detail });
    expect(gate.unusable).toEqual([{ name: "part-0.json", why: detail }]);
    const exported = new FileReuse(parts);
    expect(exported.owner(REF)).toMatchObject({ name: "part-0.json", file: { path: REF.path } });
    expect(exported.unusable).toEqual([]);
  });

  it("coverage.children at the base makes every part unusable to the gate alone", () => {
    const parts = named(part());
    const gate = new FileReuse(parts, { records: { changed: [], children: true } });
    expect(gate.owner(REF)).toMatchObject({ reason: "unusable", detail: /coverage\.children/ });
    expect(new FileReuse(parts).owner(REF)).toMatchObject({ name: "part-0.json" });
  });

  it("a passed file with no record runs at the gate; the export takes it", async () => {
    const parts = named(part([unrecorded("inspector")]));
    const gate = new FileReuse(parts, GATE);
    expect(await gate.evidence(holder(gate), INPUTS, here)).toEqual({
      refusal: { part: "part-0.json", reason: "record", detail: "inspector" },
      uncertified: [],
    });
    const exported = new FileReuse(parts);
    expect(await exported.evidence(holder(exported), INPUTS, here)).toBeNull();
  });

  it("a failed file with no record is evidence at the gate (D5); the export leaves failed files out before it asks", async () => {
    const parts = named(part([unrecorded("inspector", { outcome: "fail" })]));
    const gate = new FileReuse(parts, GATE);
    expect(await gate.evidence(holder(gate), INPUTS, here)).toBeNull();
  });

  it("a record that could not read a changed path refuses the file at the gate alone", async () => {
    const { coverage } = part();
    if (coverage === undefined) throw new Error("no coverage");
    const records = [{ sources: [0], unread: ["src/a.ts"] }];
    const parts = named(part([file()], { coverage: { ...coverage, records } }));
    const gate = new FileReuse(parts, GATE);
    expect((await gate.evidence(holder(gate), INPUTS, here))?.refusal).toEqual({
      part: "part-0.json",
      reason: "unread",
      input: "src/a.ts",
    });
    const exported = new FileReuse(parts);
    expect(await exported.evidence(holder(exported), INPUTS, here)).toBeNull();
  });

  it("a record that holds other bytes of a source refuses the file at the gate alone", async () => {
    const parts = named(part());
    const read = ["test/a.test.ts", "data/x.txt"];
    const edited = (path: string) => (path === "src/a.ts" ? blob("edited\n") : here(path));
    const gate = new FileReuse(parts, GATE);
    expect((await gate.evidence(holder(gate), read, edited))?.refusal).toEqual({
      part: "part-0.json",
      reason: "source",
      input: "src/a.ts",
    });
    const exported = new FileReuse(parts);
    expect(await exported.evidence(holder(exported), read, edited)).toBeNull();
  });
});

describe("FileReuse.evidence: one input certification for both readers (row 020-52)", () => {
  /** A part that read other content of `data/x.txt` and holds no evidence of the test file. */
  function stale(): NamedPart[] {
    const { "test/a.test.ts": _test, ...evidence } = EVIDENCE;
    return named(part([file()], { evidence: { ...evidence, "data/x.txt": blob("y\n") } }));
  }

  it("the gate's refusal names the first input by name; the export's certifier lists them all in closure order", async () => {
    const parts = stale();
    const gate = new FileReuse(parts, GATE);
    expect(await gate.evidence(holder(gate), INPUTS, here)).toEqual({
      refusal: {
        part: "part-0.json",
        reason: "input",
        input: "data/x.txt",
        detail: "its part read other content; 1 more inputs",
      },
      uncertified: ["test/a.test.ts", "data/x.txt"],
    });
    const keys = { cache: { hashOf: here } } as unknown as WorktreeKeys;
    expect(await certifier("/no-root", keys, parts)(REF, INPUTS)).toEqual([
      "test/a.test.ts",
      "data/x.txt",
    ]);
  });

  it("reads content here through the reader's own reading, only for an input the part holds evidence of", async () => {
    const parts = named(part());
    const reuse = new FileReuse(parts);
    const unknown = vi.fn((path: string) => (path === "data/x.txt" ? undefined : here(path)));
    const refused = await reuse.evidence(holder(reuse), [...INPUTS, "data/new.txt"], unknown);
    expect(refused?.refusal).toMatchObject({
      input: "data/new.txt",
      detail: "its part holds no evidence of it; 1 more inputs",
    });
    expect(refused?.uncertified).toEqual(["data/x.txt", "data/new.txt"]);
    expect(unknown.mock.calls.map(([path]) => path)).toEqual(INPUTS);
  });
});

describe("duplicate: one file at the gate, the whole set at the export (row 020-52)", () => {
  it("the gate refuses the file two parts hold and takes the others; the export finds the first in the parts' order", () => {
    const b = { project: "", path: "test/b.test.ts" };
    const parts: NamedPart[] = [
      { file: "z.json", part: part([file(), file({ path: b.path })]) },
      { file: "a.json", part: part([file()]) },
    ];
    const gate = new FileReuse(parts, GATE);
    expect(gate.owner(REF)).toEqual({
      part: "a.json",
      reason: "duplicate",
      detail: "also in z.json",
    });
    expect(gate.owner(b)).toMatchObject({ name: "z.json" });
    expect(firstShared(parts)).toMatchObject({
      file: { path: REF.path },
      first: "z.json",
      second: "a.json",
    });
  });
});

describe("environment: the gate asks of the file's project, the export of every project (row 020-52)", () => {
  it("a part whose other project wrote snapshots still gives this project's file to the gate", () => {
    const other = partProject(GATE_ENVIRONMENT.env, { ...RUNNER, project: "b" });
    const projects = [partProject(), { ...other, updateSnapshot: "all" as const }];
    const [one] = named(part([file()], { projects }));
    if (one === undefined) throw new Error("no part");
    const { descriptor, snapshotOptions } = partProject();
    const place: Place = {
      name: "here",
      runner: "Vitest",
      runs: new Map([["", { descriptor, snapshotOptions }]]),
    };
    const check = (n: NamedPart, project: string) => reuseRefusal(n, place, project)?.text ?? null;
    const gate = new FileReuse([one], GATE);
    expect(gate.environment(holder(gate), "", check)).toBeNull();
    expect(gate.environment(holder(gate), "b", check)).toMatchObject({
      part: "part-0.json",
      reason: "environment",
      detail: expect.stringContaining('snapshot update "all"'),
    });
    expect(reuseRefusal(one, place)).toMatchObject({ kind: "snapshot" });
  });
});

describe("closure: the gate refuses the file; the export counts it unkeyed (row 020-52)", () => {
  it("refuses a file the runner gives no closure of, and no other", () => {
    const reuse = new FileReuse(named(part()), GATE);
    const owner = holder(reuse);
    expect(reuse.closure(owner, null)).toEqual({ part: "part-0.json", reason: "closure" });
    const closure = { testFile: REF, paths: INPUTS };
    expect(reuse.closure(owner, closure)).toBe(closure);
  });
});
