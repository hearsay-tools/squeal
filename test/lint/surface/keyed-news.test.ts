import { describe, expect, it, vi } from "vitest";
import type { LintFile } from "../../../src/core/lint/pass/index.js";
import {
  acknowledgeLint,
  readLintNews,
  registerLint,
  tellLint,
} from "../../../src/core/lint/surface/deliver.js";
import { lintLines } from "../../../src/core/lint/surface/format.js";
import { FakeProvider } from "../pass/helpers.js";
import { consumer, lintRig, ownAfter, said } from "./helpers.js";

/*
 * Review 0.1.360 B1: a file's news is evidence of the state the consumer is
 * told, so a transition from before the last first or config keying, judged
 * under the config before it, is never told as the file's change; the
 * summary takes it in by count. An edit after the keying is told, with its
 * own findings only.
 */

/** `no-undef` off: the starting config. */
const CONFIG_A = "export default [{ rules: { 'no-undef': 'off' } }];\n";
/** `no-undef` back on, `no-console` off. */
const CONFIG_B = "export default [{ rules: { 'no-console': 'off' } }];\n";

/** A fake provider with `CONFIG_A`'s rule off. */
function underA(provider = new FakeProvider()) {
  provider.off.add("no-undef");
  return provider;
}

/** The config changed to `CONFIG_B`: `no-console` off, `no-undef` on. */
function toB(rig: Awaited<ReturnType<typeof lintRig>>) {
  rig.provider.off.clear();
  rig.provider.off.add("no-console");
  rig.tree.write("eslint.config.js", CONFIG_B);
}

/**
 * `a` passes under `CONFIG_A` and the consumer registers; its own edit adds a
 * `no-console` finding at revision 2, not yet delivered; the config then
 * turns `no-console` off and `no-undef` on, at revision 3, so `a` fails on
 * `no-undef` only.
 */
async function acrossConfig(provider = underA()) {
  const rig = await lintRig(
    { "eslint.config.js": CONFIG_A, "src/a.js": "bad no-undef\n" },
    { fake: provider },
  );
  const me = consumer(rig.tree);
  expect(registerLint(rig.source, me, 5_000)).toEqual({ v: 1, failing: 0, stale: 0 });
  rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
  await rig.revise();
  return { rig, me, since: () => ownAfter(1) };
}

const SUMMARY = "Lint config changed: 1 file with findings now; squeal lint lists them.";

describe("lint news from before a config keying (review 0.1.360 B1)", () => {
  it("tells the summary only: the pre-keying finding is not in the file's result", async () => {
    const { rig, me, since } = await acrossConfig();
    toB(rig);
    await rig.revise();
    const news = tellLint(rig.source, me, 5_100, since);
    expect(news).toEqual({
      v: 1,
      entries: [],
      more: 0,
      summary: { reason: "config", revision: 3, failing: 1, stale: 0 },
    });
    expect(lintLines(news ?? expect.unreachable(), "squeal")).toEqual([SUMMARY]);
    expect(tellLint(rig.source, me, 5_200, since)).toBeNull();

    // The view was seeded again with `a` failing: an edit after the keying is told against it.
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\nbad no-alert\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_300, since)?.entries.map(said)).toEqual([
      "fail-changed src/a.js +no-alert",
    ]);
  });

  it("tells an edit after the keying with its own findings, beside the summary", async () => {
    const { rig, me, since } = await acrossConfig();
    toB(rig);
    await rig.revise();
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\nbad no-alert\n");
    await rig.revise();
    const news = tellLint(rig.source, me, 5_100, since);
    expect(news?.entries.map(said)).toEqual(["pass-to-fail src/a.js +no-alert"]);
    expect(lintLines(news ?? expect.unreachable(), "squeal")).toEqual([
      SUMMARY,
      "FAIL lint: src/a.js: 2 findings, +1 no-alert (no-alert found)",
    ]);
    expect(tellLint(rig.source, me, 5_200, since)).toBeNull();
    // The told change is in the view in full: its fix is told.
    rig.tree.write("src/a.js", "bad no-undef\n");
    await rig.revise();
    expect(tellLint(rig.source, me, 5_300, since)?.entries.map(said)).toEqual([
      "fail-changed src/a.js -no-alert",
    ]);
  });

  it("tells an edit while the summary waits for the keying's files, then the summary", async () => {
    const held = new HeldProvider();
    // More files than one part holds, so the keying's backlog lints in two parts.
    const fillers = Array.from({ length: 17 }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);
    const rig = await lintRig(
      {
        "eslint.config.js": CONFIG_A,
        "src/a.js": "bad no-undef\n",
        ...Object.fromEntries(fillers.map((p) => [p, "ok\n"])),
      },
      { fake: underA(held) },
    );
    const me = consumer(rig.tree);
    const since = () => ownAfter(1);
    registerLint(rig.source, me, 5_000);
    rig.tree.write("src/a.js", "bad no-undef\nbad no-console\n");
    await rig.revise();

    // The keying's first part, with `a`, waits; the edit lands; the second part waits.
    const first = held.hold("src/a.js");
    const second = held.hold("src/f16.js");
    toB(rig);
    rig.tree.revise();
    rig.pass.nudge();
    await vi.waitFor(() => expect(held.reached).toEqual(["src/a.js"]));
    rig.tree.write("src/a.js", "bad no-undef\nbad no-alert\n");
    rig.tree.revise();
    rig.pass.nudge();
    first();
    await vi.waitFor(() => expect(held.reached).toEqual(["src/a.js", "src/f16.js"]));
    expect(rig.store.states.list(rig.tree.id, { paths: ["src/a.js"] })[0]).toMatchObject({
      outcome: "fail",
      stale: false,
    });

    const read = readLintNews(rig.source, me, 5_100, since);
    expect(read?.news).toEqual({
      v: 1,
      entries: [expect.objectContaining({ path: "src/a.js", findings: 2, revision: 4 })],
      more: 0,
    });
    expect(read?.news?.entries.map(said)).toEqual(["pass-to-fail src/a.js +no-alert"]);
    acknowledgeLint(rig.source, me, read?.ack ?? expect.unreachable());
    expect(tellLint(rig.source, me, 5_200, since)).toBeNull();

    second();
    await rig.pass.idle();
    expect(tellLint(rig.source, me, 5_300, since)).toEqual({
      v: 1,
      entries: [],
      more: 0,
      summary: { reason: "config", revision: 3, failing: 1, stale: 0 },
    });
    expect(tellLint(rig.source, me, 5_400, since)).toBeNull();
  });
});

describe("lint acknowledgements across a config keying (review 0.1.360 B1, rule 2)", () => {
  it("acknowledges a read from before the keying, then tells the summary only", async () => {
    const { rig, me, since } = await acrossConfig();
    const read = readLintNews(rig.source, me, 5_100, since);
    expect(read?.news?.entries.map(said)).toEqual(["pass-to-fail src/a.js +no-console"]);
    // The config keying commits between the read and its acknowledgement.
    toB(rig);
    await rig.revise();
    acknowledgeLint(rig.source, me, read?.ack ?? expect.unreachable());
    expect(tellLint(rig.source, me, 5_200, since)).toEqual({
      v: 1,
      entries: [],
      more: 0,
      summary: { reason: "config", revision: 3, failing: 1, stale: 0 },
    });
    expect(tellLint(rig.source, me, 5_300, since)).toBeNull();
  });

  it("acknowledged newest then oldest: the summary's view and mark stay, nothing told again", async () => {
    const { rig, me, since } = await acrossConfig();
    const older = readLintNews(rig.source, me, 5_100, since);
    toB(rig);
    await rig.revise();
    const newer = readLintNews(rig.source, me, 5_200, since);
    expect(newer?.news?.entries).toEqual([]);
    expect(newer?.news?.summary?.reason).toBe("config");
    acknowledgeLint(rig.source, me, newer?.ack ?? expect.unreachable());
    const view = rig.store.views.list(me);
    acknowledgeLint(rig.source, me, older?.ack ?? expect.unreachable());
    expect(rig.store.views.list(me)).toEqual(view);
    expect(tellLint(rig.source, me, 5_300, since)).toBeNull();
  });

  it("acknowledged oldest then newest: the newer writes nothing, and its summary is still owed", async () => {
    const { rig, me, since } = await acrossConfig();
    const older = readLintNews(rig.source, me, 5_100, since);
    toB(rig);
    await rig.revise();
    const newer = readLintNews(rig.source, me, 5_200, since);
    acknowledgeLint(rig.source, me, older?.ack ?? expect.unreachable());
    acknowledgeLint(rig.source, me, newer?.ack ?? expect.unreachable());
    const owed = tellLint(rig.source, me, 5_300, since);
    expect(owed?.entries).toEqual([]);
    expect(owed?.summary).toEqual({ reason: "config", revision: 3, failing: 1, stale: 0 });
    expect(tellLint(rig.source, me, 5_400, since)).toBeNull();
  });
});

/** The fake provider, holding the first lint call that asks for a held file until it is let go. */
class HeldProvider extends FakeProvider {
  readonly #held = new Map<string, Promise<void>>();
  /** The held files whose call came, in order. */
  readonly reached: string[] = [];

  /** Holds the next call with `path`; the function returned lets it go. */
  hold(path: string): () => void {
    let release = () => {};
    this.#held.set(
      path,
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    return () => release();
  }

  override async lint(files: readonly LintFile[]) {
    for (const file of files) {
      const held = this.#held.get(file.path);
      if (held === undefined) continue;
      this.#held.delete(file.path);
      this.reached.push(file.path);
      await held;
    }
    return super.lint(files);
  }
}
