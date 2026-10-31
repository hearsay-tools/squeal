import { describe, expect, it } from "vitest";
import { fileEndText } from "../../src/cli/named-file-end.js";
import { classLines, fileEntry, reasonGroups } from "../../src/cli/named-file-lines.js";
import type { NamedFile } from "../../src/cli/named-files.js";
import { timeText } from "../../src/core/text.js";
import type { FileEnd, Standing, TestFileRef } from "../../src/core/types/index.js";

/*
 * Row 011-274 (gh-111; spec 011 C15): the line forms of a selected file its
 * runner reported ended while its tier runs (`tier-file-end.test.ts` runs
 * them through the scheduler). Times print as the host's clock reads them.
 */
const START = Date.UTC(2026, 9, 31, 6, 39, 33);
const AS_OF = START + 2_000;
const ref = (path: string, project = ""): TestFileRef => ({ project, path });
const T = timeText;

const end = (unreported: readonly TestFileRef[], unreportedCount = unreported.length): FileEnd => ({
  revision: 4,
  asOf: AS_OF,
  unreported,
  unreportedCount,
});

const running: Standing = { kind: "running", lane: "vitest", since: START, files: 5, ended: 2 };

const pending = (path: string, fileEnd?: FileEnd): NamedFile => ({
  testFile: ref(path),
  state: "pending",
  pending: running,
  standing: running,
  ...(fileEnd === undefined ? {} : { end: fileEnd }),
});

describe("the line of a file that ended while its tier runs (row 011-274)", () => {
  it("names the files not reported ended, at most three, then counts the rest", () => {
    expect(fileEndText(end([ref("test/b.test.ts")]))).toBe(
      `ended at revision 4, awaiting the tier's final checks and 1 file not reported ended as of ${T(AS_OF)} (test/b.test.ts)`,
    );
    const three = [ref("test/b.test.ts"), ref("test/c.test.ts", "web"), ref("test/d.test.ts")];
    expect(fileEndText(end(three, 40))).toBe(
      `ended at revision 4, awaiting the tier's final checks and 40 files not reported ended as of ${T(AS_OF)} (test/b.test.ts, web: test/c.test.ts, test/d.test.ts and 37 more)`,
    );
  });

  it("with every file reported ended, it still awaits the tier's final checks", () => {
    expect(fileEndText(end([]))).toBe(
      `ended at revision 4, awaiting the tier's final checks (every file of the tier reported ended as of ${T(AS_OF)})`,
    );
  });

  it("files that ended alike share a line apart from the tier's other files; text and JSON agree", () => {
    const peers = [ref("test/c.test.ts")];
    const files = [
      pending("test/a.test.ts", end(peers)),
      pending("test/b.test.ts", end(peers)),
      pending("test/c.test.ts"),
    ];
    const tier = `in the vitest tier of 5 test files running since ${T(START)}, 2 of them ended`;
    const ended = `ended at revision 4, awaiting the tier's final checks and 1 file not reported ended as of ${T(AS_OF)} (test/c.test.ts), ${tier}`;
    const step = "no command runs them sooner (a running tier is not interrupted)";
    expect(classLines(files, "squeal")).toEqual([
      "Pending (3):",
      `  2 ${ended}: test/a.test.ts, test/b.test.ts; ${step}`,
      `  1 ${tier}: test/c.test.ts; no command runs it sooner (a running tier is not interrupted)`,
    ]);
    expect(reasonGroups(files, "squeal")).toBe(`2 ${ended}, 1 ${tier}`);
    const [a, , c] = files.map((f) => fileEntry(f, "squeal"));
    expect(a).toMatchObject({ state: "pending", reason: ended, ended: 2, fileEnd: end(peers) });
    expect(a?.verdict).toBeUndefined();
    expect(c?.fileEnd).toBeUndefined();
    expect(c?.reason).toBe(tier);
  });
});
