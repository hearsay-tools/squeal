import { describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../src/core/types/common.js";
import {
  type Fixture,
  fixture,
  git,
  link,
  linkInstall,
  ref,
  write,
} from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-07, review wave-7 (`reviews/wave-7.md`) B2, B4, B5, B6, B7: each
 * blocker's probe as a regression, on `$TMPDIR` fixtures with the real
 * Vitest adapter and `--run`'s real child.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };
const RUN = { allMissing: false, timeoutSeconds: 600 } as const;

interface FileJson {
  project: string;
  path: string;
  at: {
    state: string;
    failed?: string[];
    reason?: string;
    origin?: { kind: string; stored?: boolean };
  };
}
const filesOf = (out: string) => JSON.parse(out).files as FileJson[];
const atOf = (out: string, path: string, project = "") =>
  filesOf(out).find((f) => f.path === path && f.project === project)?.at;

const head = (f: Fixture) => git(f.root, "rev-parse", "HEAD").trim();

/** Two Vitest projects that list the same file; `fails` sets `MODE` to `bad`. Each has its own setup file. */
const PROJECTS = [
  "export default { test: { projects: [",
  '  { test: { name: "passes", include: ["test/*.test.ts"], env: { MODE: "good" }, setupFiles: ["setup/p.ts"] } },',
  '  { test: { name: "fails", include: ["test/*.test.ts"], env: { MODE: "bad" }, setupFiles: ["setup/f.ts"] } },',
  "] } };",
  "",
].join("\n");

const MODE_TEST = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("value", () => {',
  "  expect(value).toBe(1);",
  '  expect(process.env.MODE).toBe("good");',
  "});",
  "",
].join("\n");

function projects(): { f: Fixture; a: string } {
  const f = fixture({
    ...ON,
    "vitest.config.mjs": PROJECTS,
    "setup/p.ts": "export {};\n",
    "setup/f.ts": "export {};\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: MODE_TEST,
  });
  return { f, a: head(f) };
}

const options = (f: Fixture) => ({ cacheRoot: f.cacheRoot, install: linkInstall().install });

describe("status --at --run, review wave-7 regressions (row 023-07)", SLOW, () => {
  it("B2: reports each project's own outcome for a shared path, and stores each at its own key", async () => {
    const { f, a } = projects();
    f.commit({ "src/a.ts": "export const value = 1; // b\n" });
    const ran = await run(f, { commit: a, json: true, run: RUN }, options(f));
    expect(atOf(ran.out, TEST.path, "passes")).toMatchObject({
      state: "pass",
      origin: { kind: "run", stored: true },
    });
    expect(atOf(ran.out, TEST.path, "fails")).toMatchObject({
      state: "fail",
      failed: ["value"],
      origin: { kind: "run", stored: true },
    });
    const read = await run(f, { commit: a, json: true }, options(f));
    expect(atOf(read.out, TEST.path, "passes")?.state).toBe("pass");
    expect(atOf(read.out, TEST.path, "fails")).toMatchObject({ state: "fail", failed: ["value"] });
    clean(f);
  });

  it("B2, B4: a setup-only diff selects only its project's file; the other project is told only from the store", async () => {
    const { f, a } = projects();
    f.commit({ "setup/f.ts": "export const changed = true;\n" });
    const ran = await run(f, { commit: a, json: true, run: RUN }, options(f));
    expect(JSON.parse(ran.out).run).toMatchObject({ selected: 1, ran: 2, stored: 2 });
    expect(atOf(ran.out, TEST.path, "fails")).toMatchObject({
      state: "fail",
      origin: { kind: "run" },
    });
    // Not selected, but the gate ran its path too and stored it: it reads from the store.
    expect(atOf(ran.out, TEST.path, "passes")).toMatchObject({
      state: "pass",
      origin: { kind: "run", stored: true },
    });
    clean(f);
  });

  it("B4: a config-only diff and a declared input's change select the files they feed", async () => {
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({ inputs: { "test/data.test.ts": ["data/*.json"] } })}\n`,
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
      "test/data.test.ts": testOf("a", 1),
      "data/x.json": "{}\n",
    });
    const a = head(f);
    f.commit({
      "vitest.config.mjs":
        'export default { test: { include: ["test/*.test.ts"], globals: true } };\n',
    });
    const config = await run(f, { commit: a, json: true, run: RUN }, options(f));
    expect(JSON.parse(config.out).run).toMatchObject({ selected: 2, ran: 2 });
    expect(atOf(config.out, TEST.path)?.state).toBe("pass");

    const b = head(f);
    f.commit({ "data/x.json": '{ "changed": true }\n' });
    const input = await run(f, { commit: b, json: true, run: RUN }, options(f));
    expect(JSON.parse(input.out).run).toMatchObject({ selected: 1, ran: 1 });
    expect(atOf(input.out, "test/data.test.ts")).toMatchObject({
      state: "pass",
      origin: { kind: "run" },
    });
    expect(atOf(input.out, TEST.path)?.state).toBe("no result");
    clean(f);
  });

  it("B5: an install that rewrites a tracked file keys and runs nothing, and stores nothing", async () => {
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      [TEST.path]: testOf("a", 1),
    });
    const a = head(f);
    f.commit({ "src/a.ts": "export const value = 3;\n" });
    const install = async (tree: AbsolutePath) => {
      link(tree);
      write(tree, { "src/a.ts": "export const value = 1;\n" });
      return { ok: true, command: "link", ms: 0 } as const;
    };
    const rewritten = await run(f, { commit: a, run: RUN }, { cacheRoot: f.cacheRoot, install });
    expect(rewritten.code).toBe(3);
    expect(rewritten.out).toContain(
      `The checkout gave no keys: install: link changed files git holds at ${a.slice(0, 9)}: src/a.ts`,
    );
    expect(rewritten.out).not.toContain("--run:");
    const plain = await run(f, { commit: a, json: true }, options(f));
    expect(atOf(plain.out, TEST.path)?.state).toBe("no result");
    clean(f);
  });

  it("B6: a required source only the user's tree holds is not comparable; an absent snapshot is no reason", async () => {
    const MISSING = ref("test/missing.test.ts");
    const f = fixture({
      ...ON,
      ".gitignore": "node_modules/\nsrc/missing.ts\n",
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
      [MISSING.path]: testOf("missing", 1),
    });
    write(f.root, { "src/missing.ts": "export const value = 1;\n" });
    const a = head(f);
    f.commit({ [MISSING.path]: testOf("missing", 1).replace("it(", "it.skip(") });
    f.commit({ [TEST.path]: testOf("a", 1).replace("value", "value ") });
    const ran = await run(f, { commit: a, json: true, run: RUN }, options(f));
    expect(atOf(ran.out, MISSING.path)).toEqual({
      state: "not comparable",
      reason: "needs src/missing.ts",
    });
    // Its snapshot path is in its closure and exists nowhere: it runs.
    expect(atOf(ran.out, TEST.path)).toMatchObject({ state: "pass", origin: { kind: "run" } });
    expect(JSON.parse(ran.out).run).toMatchObject({ selected: 1, ran: 1, notComparable: 1 });
    clean(f);
  });

  it("B7: with coverage off, the run is reported not stored, and the next --at has no result", async () => {
    const f = fixture({
      "squeal.config.json": `${JSON.stringify({ coverage: { enabled: false } })}\n`,
      "src/a.ts": "export const value = 1;\n",
      [TEST.path]: testOf("a", 1),
    });
    const a = head(f);
    f.commit({ "src/a.ts": "export const value = 1; // b\n" });
    const text = await run(f, { commit: a, run: RUN }, options(f));
    const at = a.slice(0, 9);
    expect(text.out).toContain(`${TEST.path}: pass -> `);
    expect(text.out).toContain("run by this command, not stored");
    expect(text.out).toContain(
      `--run: 1 of 1 test files with no result at ${at} ran in its checkout, 0 stored at its keys`,
    );
    expect(text.out).toContain(
      `1 not stored: the gate keeps a result only with coverage on at ${at}`,
    );
    expect(text.out).not.toContain("1 stored");
    const json = await run(f, { commit: a, json: true }, options(f));
    expect(atOf(json.out, TEST.path)?.state).toBe("no result");
    clean(f);
  });
});
