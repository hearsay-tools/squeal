import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countsText } from "../../src/cli/ci-export.js";
import type { CiExport } from "../../src/core/ci/export.js";
import type { Part } from "../../src/core/ci/parts.js";
import { descriptor, evidenceOf, exported, file, repository } from "./export-keys-kit.js";

/*
 * Spec 018 D33 (row 018-58): `ci export` of hand-made format 6 parts. Each
 * file's closure is itself and `src/x.ts`; its shard read the test file and
 * not `src/x.ts`, as another shard's lazy import or a declared input that
 * only a shell reads. The endpoint fields are what row 018-57's `ci record`
 * writes for each case of the spec's Testing section.
 */

const FILES = [file("test/a.test.ts", "pass"), file("test/b.test.ts", "pass")];
const UNREAD = "src/x.ts";

async function exportOf(part: Partial<Part>, edit?: (root: string) => void): Promise<CiExport> {
  const { root, commit } = await repository();
  const { [UNREAD]: _unread, ...read } = evidenceOf(root);
  edit?.(root);
  return exported(root, commit, descriptor(), FILES, read, { part });
}

function counts(result: CiExport) {
  if ("refused" in result) throw new Error(result.refused.text);
  const { testFiles, uncertified, endpoints } = result.counts;
  return { testFiles, uncertified, endpoints };
}

describe("ci export certifies inputs nothing touched (spec 018 D33)", () => {
  it("exports a file whose unread input had the commit's content at both ends, and counts it apart", async () => {
    const result = await exportOf({ stable: {}, touched: [] });
    expect(counts(result)).toEqual({ testFiles: 2, uncertified: 0, endpoints: 2 });
    if ("refused" in result) return;
    expect(countsText(result.counts, "x.json.gz")).toBe(
      "Exported 2 test files, 4 results, to x.json.gz.\n2 of them rest on inputs that nothing in their shard's command read, listed or wrote, certified by equal hashes at the command's start and end.",
    );
  });

  it("D34: a change restored within the command leaves both ends equal, so the file is exported", async () => {
    // A shell overwrote src/x.ts, `cat` read it, `git checkout` restored it: no hooked process
    // saw either, and both hashes are the commit's. The pass may belong to the temporary
    // content; D8's condition states this residual.
    const result = await exportOf({ stable: {}, unstable: [], touched: [] });
    expect(counts(result)).toEqual({ testFiles: 2, uncertified: 0, endpoints: 2 });
  });

  it("leaves out a file whose unread input a hooked process touched, or that changed and stayed changed", async () => {
    const left = { testFiles: 0, uncertified: 2, endpoints: 0 };
    expect(counts(await exportOf({ stable: {}, touched: [UNREAD] }))).toEqual(left);
    expect(counts(await exportOf({ stable: {}, touched: "all" }))).toEqual(left);
    expect(counts(await exportOf({ stable: {}, unstable: [UNREAD], touched: [] }))).toEqual(left);
  });

  it("leaves out a file whose unread input here is not its content at the ends", async () => {
    const edit = (root: string) => writeFileSync(join(root, UNREAD), "// changed here\n");
    const result = await exportOf({ stable: {}, touched: [] }, edit);
    expect(counts(result)).toEqual({ testFiles: 0, uncertified: 2, endpoints: 0 });
  });

  it("exports a part of format 5 exactly as today: an unread input leaves its file out", async () => {
    const result = await exportOf({ format: "squeal-ci-part/5" });
    expect(counts(result)).toEqual({ testFiles: 0, uncertified: 2, endpoints: 0 });
  });

  it("gives the same bundle for a format 5 part and a format 6 part when every input was read", async () => {
    const bundleOf = async (part: Partial<Part>) => {
      const { root, commit } = await repository();
      const result = await exported(root, commit, descriptor(), FILES, evidenceOf(root), { part });
      if ("refused" in result) throw new Error(result.refused.text);
      expect(result.counts.endpoints).toBe(0);
      return result.bundle;
    };
    const five = await bundleOf({ format: "squeal-ci-part/5" });
    const six = await bundleOf({ stable: {}, touched: [] });
    const comparable = (bundle: typeof five) => ({
      ...bundle,
      header: { ...bundle.header, commit: "" },
    });
    expect(comparable(six)).toEqual(comparable(five));
  });
});
