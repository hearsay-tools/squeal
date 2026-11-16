import { afterEach, describe, expect, it } from "vitest";
import {
  conditionsOutsideKey,
  effectiveEnvironment,
  withEnvironment,
} from "../../src/cli/code-gate-files-env.js";

/*
 * Review wave 1 B2 (row 023-04): the one environment of a `runGateFiles`
 * call, held in `process.env` for the call and restored exactly after it,
 * one such call at a time; and the variables that make a run a condition
 * its key does not hold (spec 023 D5.3).
 */

const NAMES = ["GATE_ENV_A", "GATE_ENV_B"] as const;
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of NAMES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("runGateFiles' environment (review wave 1 B2, row 023-04)", () => {
  it("asks for none by default, else the given env or the process's with the call's TMPDIR", () => {
    process.env.GATE_ENV_A = "a";
    expect(effectiveEnvironment({})).toBeNull();
    expect(effectiveEnvironment({ env: { X: "1", Y: undefined } })).toEqual({ X: "1" });
    expect(effectiveEnvironment({ tempDir: "/t" })).toMatchObject({
      GATE_ENV_A: "a",
      TMPDIR: "/t",
    });
    expect(effectiveEnvironment({ env: { TMPDIR: "/x" }, tempDir: "/t" })).toEqual({
      TMPDIR: "/t",
    });
  });

  it("names the variables set or unset outside the allow-list, TMPDIR aside", () => {
    const base = { HOME: "/h", KEYED: "1", TMPDIR: "/a", GONE: "x" };
    const env = { HOME: "/other", KEYED: "2", TMPDIR: "/b", NEW: "y" };
    expect(conditionsOutsideKey(env, base, ["KEYED"])).toEqual(["GONE", "HOME", "NEW"]);
    expect(conditionsOutsideKey(base, base, [])).toEqual([]);
  });

  it("holds exactly the env during the call and restores the process's after it, a throw too", async () => {
    process.env.GATE_ENV_A = "kept";
    delete process.env.GATE_ENV_B;
    const env: NodeJS.ProcessEnv = { ...process.env, GATE_ENV_B: "set" };
    delete env.GATE_ENV_A;
    const read = () => [process.env.GATE_ENV_A, process.env.GATE_ENV_B];

    expect(await withEnvironment(env, async () => read())).toEqual([undefined, "set"]);
    expect(read()).toEqual(["kept", undefined]);
    const boom = withEnvironment(env, async () => {
      throw new Error("boom");
    });
    await expect(boom).rejects.toThrow("boom");
    expect(read()).toEqual(["kept", undefined]);
  });

  it("refuses a call while another holds process.env, and an own env while another runs", async () => {
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const holding = withEnvironment({ ...process.env }, () => gate);
    await expect(withEnvironment(null, async () => 1)).rejects.toThrow(/another call/);
    release();
    await holding;

    let free = () => {};
    const open = new Promise<void>((done) => {
      free = done;
    });
    const plain = withEnvironment(null, () => open);
    await expect(withEnvironment({ ...process.env }, async () => 1)).rejects.toThrow(
      /another call/,
    );
    expect(await withEnvironment(null, async () => 2)).toBe(2);
    free();
    await plain;
    expect(await withEnvironment({ ...process.env }, async () => 3)).toBe(3);
  });
});
