import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type PolicyInputs } from "../../src/core/types/index.js";
import { openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import { createRepo, freshOutcomes, NEW, OLD, stored } from "./stamps-repo.js";
import {
  CSS,
  NEW_CSS,
  OLD_CSS,
  OPTIMIZED,
  optimizeNow,
  probeTouched,
  VIRTUAL,
  warmOn,
} from "./touched-repo.js";

/*
 * Task 001-159: caches the per-module stamps do not check (review wave-13d
 * B1, B2 and S1). Each probe reads transient bytes into the scheduler's own
 * adapter, restores them, and hands the scheduler the touch the watcher
 * would see. What is stored as current must be what a fresh adapter gives on
 * the restored disk.
 */

const ref = (path: string) => ({ project: "", path });
const VIRTUAL_TEST = ref("test/virtual.test.ts");
const PLAIN_TEST = ref("test/plain.test.ts");
const CSS_TEST = ref("test/css.test.ts");
const OPTIMIZED_TEST = ref("test/optimized.test.ts");

const open = (files: Readonly<Record<string, string>>, observe: boolean, inputs?: PolicyInputs) => {
  const repo = createRepo(files);
  return openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    observe,
    runnerPartBesideRun: true,
    ...(inputs === undefined ? {} : { policy: { inputs } }),
  });
};

describe("a virtual module's declared input with a transform of its own (review wave-13d B1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(VIRTUAL);
    expect(await freshOutcomes(repo.main, [VIRTUAL_TEST, PLAIN_TEST])).toEqual([
      ["", "test/plain.test.ts", "fail"],
      ["", "test/virtual.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "stores what the restored bytes give (observe %s)",
    SLOW,
    async (observe) => {
      const h = await open(VIRTUAL, observe);
      await probeTouched(
        h,
        async (adapter) => {
          await warmOn(h, adapter, [VIRTUAL_TEST], "src/mod.ts", NEW, OLD);
          // The input gets a transform of its own from the restored bytes.
          await adapter.closure(PLAIN_TEST);
        },
        ["src/mod.ts"],
      );
      expect(stored(h)).toEqual([
        ["", "test/plain.test.ts", "current", "fail"],
        ["", "test/virtual.test.ts", "current", "fail"],
      ]);
    },
  );
});

describe("processed CSS that @imports a project file (review wave-13d B2)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(CSS);
    expect(await freshOutcomes(repo.main, [CSS_TEST])).toEqual([["", "test/css.test.ts", "fail"]]);
  });

  it.each([
    [true, undefined],
    [false, undefined],
    [true, ["src/base.css"]],
    [false, ["src/base.css"]],
  ])(
    "stores what the restored bytes give (observe %s, inputs %j)",
    SLOW,
    async (observe, inputs) => {
      const h = await open(CSS, observe, inputs ?? DEFAULT_POLICY.inputs);
      await probeTouched(
        h,
        (adapter) => warmOn(h, adapter, [CSS_TEST], "src/base.css", NEW_CSS, OLD_CSS),
        ["src/base.css"],
      );
      expect(stored(h)).toEqual([["", "test/css.test.ts", "current", "fail"]]);
    },
  );
});

describe("the dependency optimizer through an alias (review wave-13d S1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(OPTIMIZED);
    expect(await freshOutcomes(repo.main, [OPTIMIZED_TEST])).toEqual([
      ["", "test/optimized.test.ts", "fail"],
    ]);
  });

  it.each([true, false])(
    "stores what the restored bytes give (observe %s)",
    SLOW,
    async (observe) => {
      const h = await open(OPTIMIZED, observe);
      await probeTouched(
        h,
        (adapter) =>
          warmOn(h, adapter, [OPTIMIZED_TEST], "src/mod.js", NEW, OLD, () =>
            optimizeNow(h, adapter),
          ),
        ["src/mod.js"],
      );
      expect(stored(h)).toEqual([["", "test/optimized.test.ts", "current", "fail"]]);
    },
  );
});
