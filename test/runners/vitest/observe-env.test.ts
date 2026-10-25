import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeRecorder } from "../../../src/runners/observe/index.js";
import { UNOBSERVED } from "../../../src/runners/process/recorders.js";
import { VitestObserver } from "../../../src/runners/vitest/observe.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";

/*
 * Task 001-431, spec 001 D11 Fidelity: an instance that does not observe adds
 * nothing to its workers' env, so an ordinary run under a daemon gives its
 * tests no `SQUEAL_OBSERVE` and their own `NODE_OPTIONS`. Only another
 * Squeal's recorder, inherited when a test of Squeal starts this run, is
 * taken out: its settings become `UNOBSERVED`, its preload leaves
 * `NODE_OPTIONS`.
 */

const recorder = observeRecorder(
  new URL("../../../src/runners/observe/runtime.ts", import.meta.url),
) as string;
const OUTER = JSON.stringify({ out: "/tmp/outer", root: "/w", skip: [] });
const OWN = "--require ./setup.cjs --max-old-space-size=4096";
const off = () => new VitestObserver(new WorktreePaths("/w"), () => false);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a Vitest instance that does not observe (task 001-431)", () => {
  it.each([
    ["no NODE_OPTIONS", undefined],
    ["a NODE_OPTIONS of the project's", OWN],
  ])("gives its workers nothing without another Squeal's settings: %s", (_, options) => {
    vi.stubEnv("SQUEAL_OBSERVE", undefined);
    vi.stubEnv("NODE_OPTIONS", options);
    const observer = off();
    expect(observer.start()).toStrictEqual({});
    expect(observer.injectedFor("")).toStrictEqual({});
  });

  it("puts UNOBSERVED in place of another Squeal's settings, NODE_OPTIONS left without its recorder", () => {
    vi.stubEnv("SQUEAL_OBSERVE", OUTER);
    vi.stubEnv("NODE_OPTIONS", OWN);
    expect(off().start()).toStrictEqual({ env: { SQUEAL_OBSERVE: UNOBSERVED } });
  });

  it("leaves NODE_OPTIONS out of the env option under another Squeal's recorder: each project gets it once resolved", () => {
    vi.stubEnv("SQUEAL_OBSERVE", OUTER);
    vi.stubEnv("NODE_OPTIONS", `--import ${pathToFileURL(recorder).href} ${OWN}`);
    const observer = off();
    // A top-level NODE_OPTIONS would override a root config's own (review wave 6, B2).
    const env = { SQUEAL_OBSERVE: UNOBSERVED };
    expect(observer.start()).toStrictEqual({ env });
    expect(observer.injectedFor("")).toStrictEqual(env);
    expect(observer.active).toBe(false);
  });
});
