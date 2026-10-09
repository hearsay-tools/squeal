import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type PolicyInputs } from "../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { createRepo, freshOutcomes, NEW, OLD, stored } from "./stamps-repo.js";
import {
  CSS_HELD,
  NEW_CSS,
  OLD_CSS,
  release,
  touchWhileHeld,
  VIRTUAL_HELD,
  warmOn,
} from "./touched-repo.js";

/*
 * Review wave-13e B1 (task 001-168): a run that rewrites a file with the
 * bytes it holds, while a cache serves it that file's other bytes. Its own
 * write proves nothing about which bytes it ran, so the touch withholds it
 * with observation on as with it off. The stylesheet is in no closure, so
 * only the runner's touch, not the scheduler's barrier, can withhold it.
 */

const ref = (path: string) => ({ project: "", path });
const VIRTUAL_TEST = ref("test/virtual.test.ts");
const PLAIN_TEST = ref("test/plain.test.ts");
const CSS_TEST = ref("test/css.test.ts");

const open = (files: Readonly<Record<string, string>>, observe: boolean, inputs: PolicyInputs) => {
  const repo = createRepo(files);
  return openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    observe,
    tierSize: 4,
    runnerPartBesideRun: true,
    policy: { inputs },
  });
};

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

const written = (path: string) =>
  expect.stringMatching(new RegExp(`${path} was written .*and ended as it was`));

describe("a run that rewrites a cached virtual module's declared input (review wave-13e B1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(VIRTUAL_HELD);
    release(repo.main);
    expect(await freshOutcomes(repo.main, [VIRTUAL_TEST, PLAIN_TEST])).toEqual([
      ["", "test/plain.test.ts", "fail"],
      ["", "test/virtual.test.ts", "fail"],
    ]);
  });

  it.each([true, false])("stores none of the run (observe %s)", SLOW, async (observe) => {
    const h = await open(VIRTUAL_HELD, observe, ["src/mod.ts"]);
    await touchWhileHeld(
      h,
      async (adapter) => {
        await warmOn(h, adapter, [VIRTUAL_TEST], "src/mod.ts", NEW, OLD);
        await adapter.closure(PLAIN_TEST);
      },
      "src/mod.ts",
    );
    expect(stored(h)).toEqual([]);
    expect(reasons(h, "test/virtual.test.ts")).toEqual([written("src/mod.ts")]);
  });
});

describe("a run that rewrites a stylesheet no closure names (review wave-13e B1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(CSS_HELD);
    release(repo.main);
    expect(await freshOutcomes(repo.main, [CSS_TEST])).toEqual([["", "test/css.test.ts", "fail"]]);
  });

  it.each([true, false])("stores none of the run (observe %s)", SLOW, async (observe) => {
    const h = await open(CSS_HELD, observe, DEFAULT_POLICY.inputs);
    await touchWhileHeld(
      h,
      (adapter) => warmOn(h, adapter, [CSS_TEST], "src/base.css", NEW_CSS, OLD_CSS),
      "src/base.css",
    );
    expect(stored(h)).toEqual([]);
    expect(reasons(h, "test/css.test.ts")).toEqual([written("src/base.css")]);
  });
});
