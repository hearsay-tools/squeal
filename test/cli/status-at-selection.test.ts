import { describe, expect, it } from "vitest";
import { fixture, freshKey, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, testOf, withStore } from "./status-at-kit.js";

/*
 * Review wave-6 B4 and B5 (row 023-06), each reviewer probe as a
 * regression test on a `$TMPDIR` git fixture with the real Vitest adapter.
 * B4: a checkout that gave no keys never exits 0, and its missing listing
 * never reads as absence. B5: a folder selects its test files at both
 * versions, tests deleted since the commit included, under their projects.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");
const SOURCES = {
  "src/a.ts": "export const value = 1;\n",
  "src/plain.ts": "export const value = 1;\n",
};

const failedInstall = async () =>
  ({ ok: false, command: "install", ms: 1, reason: "exit 1", log: "" }) as const;

describe("status --at after a failed checkout (review wave-6 B4)", SLOW, () => {
  it("exits 3, not 0, when the commit's listing failed and no test is listed now", async () => {
    const f = fixture({ ...SOURCES, [TEST.path]: testOf("a", 1) });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: null });
    const options = { cacheRoot: f.cacheRoot, install: failedInstall };
    const { code, out } = await run(f, { commit: before, json: true }, options);
    expect(code).toBe(3);
    const value = JSON.parse(out);
    expect(value.failure).toBe("install: install: exit 1");
    expect(value.files).toEqual([]);
    const text = await run(f, { commit: before }, options);
    expect(text.code).toBe(3);
    expect(text.out).toContain("The checkout gave no keys: install: install: exit 1");
    clean(f);
  });

  it("reads a file the commit holds as not determined, not absent, when the checkout failed", async () => {
    const f = fixture({
      ...SOURCES,
      [TEST.path]: testOf("a", 1),
      [PLAIN.path]: testOf("plain", 1),
    });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: null, "test/new.test.ts": testOf("plain", 1) });
    const options = { cacheRoot: f.cacheRoot, install: failedInstall };
    const { code, out } = await run(f, { commit: before, json: true }, options);
    expect(code).toBe(3);
    const files = JSON.parse(out).files;
    const reason = "install: install: exit 1";
    expect(files.map((x: { path: string }) => x.path)).toEqual(["test/new.test.ts", PLAIN.path]);
    // The commit's tree proves the new file's absence; the plain file's state is unknown.
    expect(files[0].at).toEqual({ state: "absent" });
    expect(files[1].at).toEqual({ state: "not determined", reason });
    clean(f);
  });
});

describe("status --at selects a folder at both versions (review wave-6 B5)", SLOW, () => {
  it("includes a test deleted from a folder that still has a current test", async () => {
    const f = fixture({
      ...SOURCES,
      [TEST.path]: testOf("a", 1),
      [PLAIN.path]: testOf("plain", 1),
    });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    const after = f.commit({ [TEST.path]: null });
    const keys = new Set([await freshKey(f, before, PLAIN), await freshKey(f, after, PLAIN)]);
    withStore(f, (store) =>
      store.results.putMany([...keys].map((key) => result(check(PLAIN.path), key))),
    );
    const { code, out } = await run(f, { commit: before, paths: ["test"], json: true });
    expect(code).toBe(3);
    const value = JSON.parse(out);
    expect(value.counts).toEqual({
      "pass -> fail": 0,
      "fail -> pass": 0,
      unchanged: 1,
      unknown: 1,
    });
    expect(value.files[0]).toMatchObject({
      path: TEST.path,
      change: "unknown",
      at: { state: "no result" },
      now: { state: "absent" },
    });
    const text = await run(f, { commit: before, paths: ["test/"] });
    expect(text.out).toContain(`${TEST.path}: no result -> absent`);
    clean(f);
  });

  it("includes the tests of a folder deleted since the commit", async () => {
    const config = 'export default { test: { include: ["test/**/*.test.ts"] } };\n';
    const f = fixture({
      ...SOURCES,
      "vitest.config.mjs": config,
      "test/old/x.test.ts":
        'import { expect, it } from "vitest";\nit("x", () => expect(1).toBe(1));\n',
      [PLAIN.path]: testOf("plain", 1),
    });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "test/old/x.test.ts": null });
    const { code, out } = await run(f, { commit: before, paths: ["test/old"], json: true });
    expect(code).toBe(3);
    const value = JSON.parse(out);
    expect(value.checkoutMs).toBeGreaterThan(0);
    expect(value.files).toEqual([
      expect.objectContaining({
        project: "",
        path: "test/old/x.test.ts",
        at: expect.objectContaining({ state: "no result" }),
        now: { state: "absent" },
      }),
    ]);
    clean(f);
  });

  it("names a test listed under a named project only at the commit by that project", async () => {
    const unit =
      'export default { test: { projects: [{ test: { name: "unit", include: ["test/*.test.ts"] } }] } };\n';
    const f = fixture({ ...SOURCES, "vitest.config.mjs": unit, [TEST.path]: testOf("a", 1) });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "vitest.config.mjs": 'export default { test: { include: ["test/*.test.ts"] } };\n',
      [TEST.path]: null,
      [PLAIN.path]: testOf("plain", 1),
    });
    const install = linkInstall();
    const options = { cacheRoot: f.cacheRoot, install: install.install };
    const { code, out } = await run(f, { commit: before, paths: [TEST.path], json: true }, options);
    expect(code).toBe(3);
    expect(JSON.parse(out).files).toEqual([
      expect.objectContaining({
        project: "unit",
        path: TEST.path,
        at: expect.objectContaining({ state: "no result" }),
        now: { state: "absent" },
      }),
    ]);
    expect(install.calls()).toBe(1);
    clean(f);
  });

  it("gives a named file and its folder the same files when its project changed (re-review B5)", async () => {
    const unit =
      'export default { test: { projects: [{ test: { name: "unit", include: ["test/*.test.ts"] } }] } };\n';
    const f = fixture({ ...SOURCES, "vitest.config.mjs": unit, [TEST.path]: testOf("a", 1) });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "vitest.config.mjs": 'export default { test: { include: ["test/*.test.ts"] } };\n',
    });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const refsOf = async (paths: string[]) => {
      const { code, out } = await run(f, { commit: before, paths, json: true }, options);
      expect(code).toBe(3);
      return JSON.parse(out).files as { project: string; path: string; at: { state: string } }[];
    };
    const named = await refsOf([TEST.path]);
    const folder = await refsOf(["test"]);
    const pairs = (files: typeof named) => files.map((x) => [x.project, x.path]);
    expect(pairs(named)).toEqual([
      ["", TEST.path],
      ["unit", TEST.path],
    ]);
    expect(pairs(folder)).toEqual(pairs(named));
    // The commit's own project is asked and keyed there; the default project lists nothing at the commit.
    const unitAt = named.find((x) => x.project === "unit")?.at;
    expect(unitAt).toMatchObject({
      state: "no result",
      key: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(named.find((x) => x.project === "")?.at).toMatchObject({ state: "not determined" });
    expect(folder.find((x) => x.project === "unit")?.at).toEqual(unitAt);
    clean(f);
  });

  it("keeps a named file that exists on neither side, with no checkout", async () => {
    const f = fixture({ ...SOURCES, [PLAIN.path]: testOf("plain", 1) });
    const before = git(f.root, "rev-parse", "HEAD").trim();
    const install = linkInstall();
    const options = { cacheRoot: f.cacheRoot, install: install.install };
    const { code, out } = await run(
      f,
      { commit: before, paths: ["test/none.test.ts"], json: true },
      options,
    );
    expect(code).toBe(3);
    const value = JSON.parse(out);
    expect(value.files).toEqual([
      expect.objectContaining({
        project: "",
        path: "test/none.test.ts",
        at: { state: "absent" },
        now: { state: "absent" },
      }),
    ]);
    expect(value.checkoutMs).toBeNull();
    expect(install.calls()).toBe(0);
    clean(f);
  });
});
