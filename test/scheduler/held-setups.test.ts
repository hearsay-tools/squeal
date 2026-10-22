import { describe, expect, it } from "vitest";
import { newFileState } from "../../src/core/scheduler/files.js";
import { heldSetups } from "../../src/core/scheduler/setup.js";
import type { StartupFailure, TestFileRef } from "../../src/core/types/index.js";

/*
 * Review 0.1.266, B2 (011 C9): which projects a run recorded while the merge
 * hold holds gives no setup outcome, and when its startup failure is the
 * hold's. The scheduler tests run it end to end (`merge-hold-setup.test.ts`).
 */

const ref = (project: string, path: string): TestFileRef => ({ project, path });
const entry = (r: TestFileRef) => ({ file: newFileState(r) });
const [a, b, x] = [ref("", "test/a.test.ts"), ref("", "test/b.test.ts"), ref("p", "p/x.test.ts")];
const [fa, fb, fx] = [entry(a), entry(b), entry(x)];
const files = [fa, fb, fx];

const hold = (unmerged: readonly string[]) => ({
  holding: unmerged.length > 0,
  names: (paths: Iterable<string>) => [...paths].some((path) => unmerged.includes(path)),
});

const startup = (projects: string[], setupFile: string | null): StartupFailure => ({
  projects,
  testFiles: [a, b, x],
  setupFile,
  error: { name: "Error", message: "setup failed", stack: null, location: null, diff: null },
});

describe("heldSetups (review 0.1.266 B2)", () => {
  it("holds nothing outside the hold", () => {
    expect(heldSetups(hold([]), files, [], startup([""], "src/helper.ts"))).toEqual({
      projects: new Set(),
      startup: false,
      notStarted: [],
    });
  });

  it("holds the held files' projects, and a startup failure that blames one, with every file it kept", () => {
    const held = heldSetups(hold(["src/helper.ts"]), files, [fa], startup([""], "src/global.ts"));
    expect(held).toEqual({ projects: new Set([""]), startup: true, notStarted: files });
  });

  it("holds the projects a startup failure blames when its setup file is unmerged, held file or none", () => {
    const held = heldSetups(hold(["src/global.ts"]), files, [], startup(["p"], "src/global.ts"));
    expect(held).toEqual({ projects: new Set(["p"]), startup: true, notStarted: files });
  });

  it("leaves a startup failure of a project it does not hold to stand", () => {
    const held = heldSetups(hold(["src/helper.ts"]), files, [fa], startup(["p"], "p/global.ts"));
    expect(held).toEqual({ projects: new Set([""]), startup: false, notStarted: [] });
    // One that names none of the tier's projects blames every one of them, the held one too.
    const none = heldSetups(hold(["src/helper.ts"]), [fx], [], startup(["q"], null));
    expect(none.startup).toBe(false);
    expect(heldSetups(hold(["src/helper.ts"]), files, [fa], startup(["q"], null)).startup).toBe(
      true,
    );
  });
});
