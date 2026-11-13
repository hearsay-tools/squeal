import { describe, expect, it } from "vitest";
import { partsEvidence } from "../../../src/core/code/gate/parts.js";
import type { PartRefusal } from "../../../src/core/code/gate/parts-refused.js";
import { writeFile } from "../../hash/git-repo.js";
import { ENVIRONMENT, GATE } from "./parts-fixture.js";
import {
  blob,
  CLOSURE,
  collected,
  EVIDENCE,
  file,
  part,
  REF,
  repos,
  taken,
  unrecorded,
} from "./parts-kit.js";

/*
 * Spec 020 D13.2 as amended by row 020-49 (#205): what makes a selected
 * file a part holds run, and the reason `partsEvidence` gives for it, one
 * case per refusal branch, in the order it checks them.
 */

const repo = repos();

/** `test/a.test.ts`'s one refusal by `part`, for `reason`, with `more`. */
const refusal = (
  reason: PartRefusal["reason"],
  more: Partial<PartRefusal> = {},
  name = "part-0.json",
): PartRefusal[] => [{ runner: "vitest", path: REF.path, part: name, reason, ...more }];

describe("partsEvidence: a file two parts hold (spec 020 D13.2, row 020-49)", () => {
  it("runs it and names the first part, and the others", async () => {
    const { evidence, refused } = await taken(repo(), [part(), part()]);
    expect(evidence).toBeNull();
    expect(refused).toEqual(refusal("duplicate", { detail: "also in part-1.json" }));
  });
});

describe("partsEvidence: a part that gives no evidence (spec 020 D13.2, row 020-49)", () => {
  it("runs every file of a run that did not record its reads, with a note", async () => {
    const blind = part();
    const why = "its run did not record what its tests read";
    const { evidence, notes, refused } = await taken(repo(), [
      { ...blind, header: { ...blind.header, observing: false } },
    ]);
    expect(evidence).toBeNull();
    expect(notes).toEqual([
      `1 part gives no evidence, so its test files run: ${why} (part-0.json)`,
    ]);
    expect(refused).toEqual(refusal("unusable", { detail: why }));
  });

  it("runs a file whose part ran in another environment, with a note (review 0.1.427 B1)", async () => {
    const other = { ...GATE, env: { PROBE: "no" } };
    const { evidence, notes, refused } = await taken(repo(), [part()], { environment: other });
    const differs = `part-0.json ran project "" in another environment than this gate's: allow-listed variables differ (values: PROBE) (the export as part-0.json's, here as this gate's)`;
    expect(evidence).toBeNull();
    expect(notes).toEqual([
      `part-0.json gives no evidence of project "", so its test files run: ${differs}`,
    ]);
    expect(refused).toEqual(refusal("environment", { detail: differs }));
  });

  it.each(["squeal", "v8"])(
    "takes a file of a part collected by %s (spec 020 D19.5)",
    async (by) => {
      const { evidence, refused } = await taken(repo(), [collected(by)]);
      expect(evidence).toMatchObject({ from: "parts" });
      expect(refused).toEqual([]);
    },
  );

  it("runs every file of a part from another collector, with a note (spec 020 D19.5)", async () => {
    const why = `its records were collected by "istanbul", which this Squeal does not read`;
    const { evidence, notes, refused } = await taken(repo(), [collected("istanbul")]);
    expect(evidence).toBeNull();
    expect(notes).toEqual([
      `1 part gives no evidence, so its test files run: ${why} (part-0.json)`,
    ]);
    expect(refused).toEqual(refusal("unusable", { detail: why }));
  });

  it("runs every file when coverage.children is on at the base, with a note", async () => {
    const why =
      "coverage.children is on at the base, and ci record collects no child process's coverage";
    const { evidence, notes, refused } = await taken(repo(), [part()], { children: true });
    expect(evidence).toBeNull();
    expect(notes).toEqual([
      `1 part gives no evidence, so its test files run: ${why} (part-0.json)`,
    ]);
    expect(refused).toEqual(refusal("unusable", { detail: why }));
  });
});

describe("partsEvidence: what makes a file of a usable part run (spec 020 D13.2, row 020-49)", () => {
  it("runs a file the runner gives no closure of here", async () => {
    const { evidence, refused } = await taken(repo(), [part()], {}, async () => null);
    expect(evidence).toBeNull();
    expect(refused).toEqual(refusal("closure"));
  });

  it("runs a file whose runtime read changed here, and names the read", async () => {
    const root = repo();
    writeFile(root, "data/x.txt", "changed\n");
    const { evidence, refused } = await taken(root, [part()]);
    expect(evidence).toBeNull();
    expect(refused).toEqual(
      refusal("input", { input: "data/x.txt", detail: "its part read other content" }),
    );
  });

  it("names the first input by path, why, and how many more differ", async () => {
    const root = repo();
    writeFile(root, "src/a.ts", "export const a = 2;\n");
    const { "test/a.test.ts": _test, ...lacking } = EVIDENCE;
    const { refused } = await taken(root, [part([file()], { evidence: lacking })]);
    expect(refused).toEqual(
      refusal("input", { input: "src/a.ts", detail: "its part read other content; 1 more inputs" }),
    );

    const { refused: unread } = await taken(repo(), [part([file()], { evidence: lacking })]);
    expect(unread).toEqual(
      refusal("input", { input: "test/a.test.ts", detail: "its part holds no evidence of it" }),
    );
  });

  it("runs a passing file with no record, and says why the part holds none", async () => {
    const { evidence, refused } = await taken(repo(), [part([unrecorded("filtered")])]);
    expect(evidence).toBeNull();
    expect(refused).toEqual(refusal("record", { detail: "filtered" }));
  });

  it("runs a file whose record could not read a changed path, and names it", async () => {
    const coverage = { sources: [], records: [{ sources: [], unread: ["src/a.ts"] }] };
    const { evidence, refused } = await taken(repo(), [part([file()], { coverage })]);
    expect(evidence).toBeNull();
    expect(refused).toEqual(refusal("unread", { input: "src/a.ts" }));
  });

  it("runs a file whose record holds other bytes of a source, and names it", async () => {
    const coverage = {
      sources: [{ path: "src/a.ts", blob: blob("old\n"), lines: "", covered: "", functions: [] }],
      records: [{ sources: [0], unread: [] }],
    };
    const { evidence, refused } = await taken(repo(), [part([file()], { coverage })]);
    expect(evidence).toBeNull();
    expect(refused).toEqual(refusal("source", { input: "src/a.ts" }));
  });
});

describe("partsEvidence: what is not a refusal (row 020-49)", () => {
  it("names no file that no part holds, nor a node:test file", async () => {
    const refused: PartRefusal[] = [];
    const evidence = partsEvidence({
      root: repo(),
      parts: [{ file: "p.json", part: part() }],
      changed: [],
      children: false,
      environment: GATE,
      refused: (r) => refused.push(r),
    });
    const other = { project: "", path: "test/other.test.ts" };
    expect(await evidence("vitest", [other], CLOSURE, ENVIRONMENT)).toEqual(new Map());
    expect(await evidence("node-test", [REF], CLOSURE, ENVIRONMENT)).toEqual(new Map());
    expect(refused).toEqual([]);
  });
});
