import { describe, expect, it } from "vitest";
import type { CodeSince } from "../../../src/core/delivery/code-since.js";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import {
  lintChanged,
  lintDetails,
  lintStatus,
  lintStop,
} from "../../../src/core/lint/surface/report.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider } from "../pass/helpers.js";
import { consumer, lintRig, ownAfter, sourceOf } from "./helpers.js";

/* Spec 017 D8: status, `squeal lint`, `--changed` and Stop, read from the store with no daemon. */

const session = (since: number): CodeSince => ({ ...ownAfter(since), scope: "session" });
const BLOCKING = { ...LINT_ON, lint: { ...LINT_ON.lint, blocking: true } };

describe("lint status and details (017 D8, D9)", () => {
  it("counts each file once, stale and unknown apart from failing, with each unknown reason", async () => {
    const fake = new FakeProvider();
    fake.wholeProgram.add("src/a.js").add("src/c.js");
    const rig = await lintRig(
      { "src/a.js": "bad no-undef\n", "src/b.js": "ok\n", "src/c.js": "ok\n", "src/d.js": "ok\n" },
      { fake, idleIn: () => 60_000 },
    );
    // `d`'s edit moves the program, so `a` and `c` read stale; then `d` cannot be linted.
    fake.unknown.set("src/d.js", "the ESLint worker timed out after 5000 ms");
    rig.tree.write("src/d.js", "ok\nok\n");
    await rig.revise();
    expect(lintStatus(rig.source, rig.tree.id, session(1))).toEqual({
      v: 1,
      files: 4,
      failing: 0,
      sinceRegistration: 0,
      since: "session",
      pending: 0,
      stale: 2,
      unknown: 1,
      reasons: [{ reason: "the ESLint worker timed out after 5000 ms", files: 1 }],
    });
    const details = lintDetails(rig.source, rig.tree.id);
    // The stale `a` is listed with the findings it was linted with, marked stale.
    expect(details?.files).toEqual([
      {
        path: "src/a.js",
        outcome: "fail",
        stale: true,
        findings: [expect.objectContaining({ rule: "no-undef", line: 1, severity: "error" })],
        revision: 1,
        blob: rig.tree.source.file("src/a.js")?.hash,
        reason: null,
      },
    ]);
    expect(details).toMatchObject({ pending: 0, stale: 2, unknown: 1, notLinted: [], waiting: [] });
    const asked = lintDetails(rig.source, rig.tree.id, ["src/d.js", "README.md", "src/b.js"]);
    expect(asked?.files.map((f) => [f.path, f.outcome, f.reason])).toEqual([
      ["src/d.js", "unknown", "the ESLint worker timed out after 5000 ms"],
      ["src/b.js", "pass", null],
    ]);
    expect(asked?.notLinted).toEqual(["README.md"]);
  });

  it("lists every file with findings newest first, and says while the first lint runs", async () => {
    const rig = await lintRig({ "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" });
    rig.tree.write("src/b.js", "bad no-console\nbad no-console\n");
    await rig.revise();
    expect(lintDetails(rig.source, rig.tree.id)?.files.map((f) => [f.path, f.revision])).toEqual([
      ["src/b.js", 2],
      ["src/a.js", 1],
    ]);
    expect(lintStatus(rig.source, rig.tree.id, null)).toMatchObject({
      files: 2,
      failing: 2,
      sinceRegistration: 0,
      since: null,
    });
  });
});

describe("lint Stop evidence (017 D8 Blocking)", () => {
  it("counts only files failing at their key that went to fail in the consumer's own revisions", async () => {
    const fake = new FakeProvider();
    fake.wholeProgram.add("src/c.js");
    const rig = await lintRig(
      { "src/a.js": "ok\n", "src/b.js": "bad no-undef\n", "src/c.js": "ok\n", "src/d.js": "ok\n" },
      { fake, idleIn: () => 60_000 },
    );
    const blocking = sourceOf(rig.tree, () => BLOCKING);
    // `a` goes to fail; `b` was failing before and changes; `c` goes to fail, then reads stale.
    rig.tree
      .write("src/a.js", "bad no-console\n")
      .write("src/b.js", "bad no-undef\nbad no-alert\n")
      .write("src/c.js", "bad no-console\n");
    await rig.revise();
    rig.tree.write("src/d.js", "ok\nok\n");
    await rig.revise();
    expect(lintStop(blocking, rig.tree.id, ownAfter(1))).toEqual({
      v: 1,
      files: [{ path: "src/a.js", findings: 1, revision: 2 }],
      notCurrent: { pending: 0, stale: 1, unknown: 0 },
    });
    expect(lintStatus(blocking, rig.tree.id, session(1))?.sinceRegistration).toBe(1);
    // Not the consumer's own revisions, or no registration: nothing counts.
    expect(lintStop(blocking, rig.tree.id, ownAfter(2))?.files).toEqual([]);
    expect(lintStop(blocking, rig.tree.id, null)?.files).toEqual([]);
    // With `lint.blocking` off, lint blocks nothing.
    expect(lintStop(rig.source, rig.tree.id, ownAfter(1))).toBeNull();
  });

  it("counts no failure a config keying may have made, though the file failed in the session", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n", "src/b.js": "ok\n" });
    const blocking = sourceOf(rig.tree, () => BLOCKING);
    // `a` fails in the session, then passes; `b` fails in the session and stays failing.
    rig.tree.write("src/a.js", "bad no-undef\n").write("src/b.js", "bad no-undef\n");
    await rig.revise();
    rig.tree.write("src/a.js", "bad no-console\n");
    rig.provider.off.add("no-console");
    await rig.revise();
    expect(rig.store.states.list(rig.tree.id).map((s) => s.outcome)).toEqual(["pass", "fail"]);
    expect(lintStop(blocking, rig.tree.id, ownAfter(1))?.files.map((f) => f.path)).toEqual([
      "src/b.js",
    ]);
    // A config change turns `no-console` on: `a` fails again with no transition. Neither file
    // counts now: since the keying, no transition says the session's edit made either fail.
    rig.provider.off.delete("no-console");
    rig.tree.write("eslint.config.js", "export default [{ rules: { 'no-console': 'error' } }];\n");
    await rig.revise();
    expect(rig.store.states.list(rig.tree.id).map((s) => s.outcome)).toEqual(["fail", "fail"]);
    expect(lintStop(blocking, rig.tree.id, ownAfter(1))?.files).toEqual([]);
    expect(lintStatus(blocking, rig.tree.id, session(1))?.sinceRegistration).toBe(0);
    // An edit after the keying that makes a file fail counts again.
    rig.tree.write("src/c.js", "bad no-undef\n");
    await rig.revise();
    expect(lintStop(blocking, rig.tree.id, ownAfter(1))?.files.map((f) => f.path)).toEqual([
      "src/c.js",
    ]);
  });
});

describe("paths as files or folders (017 D8 Details)", () => {
  it("holds the files below a folder at a / boundary, and names the paths that hold none", async () => {
    const rig = await lintRig({
      "src/a.js": "bad no-undef\n",
      "src/deep/b.js": "ok\n",
      "srcx/c.js": "bad no-console\n",
    });
    const paths = (asked: string[]) =>
      lintDetails(rig.source, rig.tree.id, asked)?.files.map((f) => f.path);
    expect(paths(["src"])).toEqual(["src/a.js", "src/deep/b.js"]);
    expect(paths(["src/", "./src/deep"])).toEqual(["src/a.js", "src/deep/b.js"]);
    expect(paths(["srcx", "src/a.js"])).toEqual(["srcx/c.js", "src/a.js"]);
    expect(paths(["."])).toEqual(["src/a.js", "src/deep/b.js", "srcx/c.js"]);
    expect(lintDetails(rig.source, rig.tree.id, ["sr", "lib", "src"])).toMatchObject({
      notLinted: ["sr", "lib"],
      waiting: [],
    });
    rig.tree.write("src/deep/b.js", "bad no-alert\n").write("srcx/c.js", "ok\n");
    await rig.revise();
    const changed = lintChanged(rig.source, rig.tree.id, session(1), ["src"]);
    expect(changed?.entries.map((e) => [e.path, e.kind])).toEqual([
      ["src/deep/b.js", "pass-to-fail"],
    ]);
    expect(changed?.entries[0]?.blob).toBe(rig.tree.source.file("src/deep/b.js")?.hash);
  });
});

describe("squeal lint --changed (017 D8)", () => {
  it("lists every change a delivery told or counted, newest first, and none outside the session", async () => {
    const files = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`src/f${n}.js`, "ok\n"]));
    const rig = await lintRig({ ...files, "src/early.js": "ok\n" });
    // A change before the session.
    rig.tree.write("src/early.js", "bad no-undef\n");
    await rig.revise();
    const me = consumer(rig.tree);
    registerLint(rig.source, me, 5_000);
    for (const path of Object.keys(files)) rig.tree.write(path, "bad no-undef\n");
    await rig.revise();
    rig.tree.write("src/f1.js", "ok\n");
    await rig.revise();
    // `f1` failed and passed again before the delivery: nothing to tell of it; 6 changes are.
    const told = tellLint(rig.source, me, 5_100, () => ownAfter(2));
    expect(told?.entries).toHaveLength(5);
    expect(told?.more).toBe(1);
    const changed = lintChanged(rig.source, rig.tree.id, session(2));
    expect(changed?.since).toBe("session");
    expect(changed?.entries.map((e) => [e.path, e.kind, e.outcome, e.findings])).toEqual([
      ["src/f1.js", "fail-to-pass", "pass", 0],
      ...[2, 3, 4, 5, 6, 7].map((n) => [`src/f${n}.js`, "pass-to-fail", "fail", 1]),
    ]);
    // Every change the delivery listed, and the one past its cap (`f7`), is listed here.
    const listed = new Set(changed?.entries.map((e) => e.path));
    for (const entry of told?.entries ?? []) expect(listed).toContain(entry.path);
    expect(listed).toContain("src/f7.js");
    expect(
      lintChanged(rig.source, rig.tree.id, session(2), ["src/f7.js", "src/early.js"])?.entries,
    ).toEqual([expect.objectContaining({ path: "src/f7.js", kind: "pass-to-fail" })]);
    expect(lintChanged(rig.source, rig.tree.id, null)?.entries).toEqual([]);
  });
});
