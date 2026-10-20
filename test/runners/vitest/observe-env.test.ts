import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNOBSERVED } from "../../../src/runners/node-test/recorders.js";
import { observeRecorder } from "../../../src/runners/observe/index.js";
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
    expect(observer.injected).toStrictEqual({});
  });

  it("puts UNOBSERVED in place of another Squeal's settings, NODE_OPTIONS left without its recorder", () => {
    vi.stubEnv("SQUEAL_OBSERVE", OUTER);
    vi.stubEnv("NODE_OPTIONS", OWN);
    expect(off().start()).toStrictEqual({ env: { SQUEAL_OBSERVE: UNOBSERVED } });
  });

  it("takes another Squeal's recorder out of NODE_OPTIONS, and keeps both out of the hash", () => {
    vi.stubEnv("SQUEAL_OBSERVE", OUTER);
    vi.stubEnv("NODE_OPTIONS", `--import ${pathToFileURL(recorder).href} ${OWN}`);
    const observer = off();
    const env = { NODE_OPTIONS: OWN, SQUEAL_OBSERVE: UNOBSERVED };
    expect(observer.start()).toStrictEqual({ env });
    expect(observer.injected).toStrictEqual(env);
    expect(observer.active).toBe(false);
  });
});
