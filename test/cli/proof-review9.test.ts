import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, link, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";

/*
 * Review wave-9 B1, B2 and B3 (row 023-11), on `$TMPDIR` git fixtures with
 * the real Vitest adapter; every command's `HOME` is a throwaway folder.
 * B1 (the human's "B"): the run's own `HOME` is empty but for the
 * `--home-keep` copies, so no path in it, `..` and aliases included,
 * reaches a real `HOME` file, and the hidden path stays absent even in a
 * kept folder that holds it.
 * B2: a `--without` path under a committed link, or a link itself, is a
 * usage error, and nothing outside the checkout changes. B3: an install
 * that puts a hidden path back means the condition did not hold: the file
 * reads `not comparable` with the changed path, never `proven`.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

function throwaway(dir: string): NodeJS.ProcessEnv {
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  return { ...process.env, HOME: home };
}

describe("squeal proof, review wave-9 (row 023-11)", { timeout: 240_000 }, () => {
  it("B2: refuses a --without path under a committed link, or a link, and deletes nothing", async () => {
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      [TEST.path]: testOf("a", 3),
    });
    const outside = join(f.dir, "outside");
    mkdirSync(join(outside, "victim", "inner"), { recursive: true });
    writeFileSync(join(outside, "victim", "inner", "file"), "must survive\n");
    symlinkSync(outside, join(f.root, "linked"));
    git(f.root, "add", "-A");
    git(f.root, "commit", "-qm", "link");
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("a", 2) });
    const env = throwaway(f.dir);
    for (const without of ["linked/victim", "linked"]) {
      const args = { files: [TEST.path], base: a, case: "dependency" as const, without: [without] };
      const result = await prove(f, args, undefined, env);
      expect(result.code, result.why).toBe(2);
      expect(result.err.trim().split("\n")).toEqual([
        `squeal proof: --without ${without}: linked is a link at ${a.slice(0, 9)}; a hidden path must not be a link or lie under one`,
      ]);
      expect(readFileSync(join(outside, "victim", "inner", "file"), "utf8")).toBe("must survive\n");
      clean(f);
    }
  });

  /** Both commits hold `value = 2` and `config/local`; the old test needs `config/local` absent. */
  function hiddenFolder() {
    const absent = [
      'import { existsSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { expect, it } from "vitest";',
      'it("absent", () => expect(existsSync(join(process.cwd(), "config/local"))).toBe(false));',
      "",
    ].join("\n");
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      "config/local": "on\n",
      [TEST.path]: absent,
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("a", 2) });
    return {
      f,
      a,
      args: { files: [TEST.path], base: a, case: "dependency" as const, without: ["config"] },
    };
  }

  it("B3: an honest install keeps the folder hidden: not red", async () => {
    const { f, args } = hiddenFolder();
    const result = await prove(f, args, undefined, throwaway(f.dir));
    expect(result.code, result.why).toBe(1);
    expect(result.files[0]).toMatchObject({ verdict: "not red", red: { end: "pass", runs: 1 } });
    clean(f);
  });

  it.each([
    [
      "puts the folder back",
      (tree: string) => {
        mkdirSync(join(tree, "config"));
        writeFileSync(join(tree, "config", "local"), "on\n");
      },
    ],
    ["leaves a dangling link at it", (tree: string) => symlinkSync("gone", join(tree, "config"))],
  ])(
    "B3: an install that %s gives not comparable with the path, and runs nothing",
    async (_, undo) => {
      const { f, args } = hiddenFolder();
      const install = async (tree: AbsolutePath) => {
        link(tree);
        undo(tree);
        return { ok: true as const, command: "link", ms: 0 };
      };
      const options = { cacheRoot: f.cacheRoot, install };
      const result = await prove(f, args, options, throwaway(f.dir));
      expect(result.code, result.why).toBe(3);
      expect(result.files[0]).toMatchObject({
        verdict: "not comparable",
        reason: "install changed the checkout: config; the condition is not known to hold",
        red: { end: "unknown", from: null, runs: 0 },
      });
      expect(result.report.runs).toBe(0);
      clean(f);
    },
  );

  /** The reviewer's B1 fixture: what the old test sees in its HOME, then its writes and deletes. */
  const PROBE = [
    'import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'it("reads its HOME", () => {',
    '  const home = process.env.HOME ?? "";',
    '  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);',
    "  const seen = {",
    "    direct: read(home + '/.proofrc'),",
    "    via: read(home + '/kept/../.proofrc'),",
    "    alias: read(home + '/.alias'),",
    "    kept: read(home + '/kept/untouched'),",
    "    secret: read(home + '/cfg/secret'),",
    "    other: read(home + '/cfg/other'),",
    "  };",
    "  writeFileSync(home + '/kept/../.proofrc', 'changed');",
    "  writeFileSync(home + '/kept/untouched', 'changed');",
    "  try { unlinkSync(home + '/.alias'); } catch {}",
    "  rmSync(home + '/kept', { recursive: true, force: true });",
    "  rmSync(home + '/cfg', { recursive: true, force: true });",
    '  writeFileSync(process.env.PROOF_OUT ?? "", JSON.stringify(seen));',
    '  expect((seen.direct ?? "").trim()).toBe("ada");',
    "});",
    "",
  ].join("\n");

  /** A throwaway HOME: `.proofrc`, `.alias` to it, `kept/untouched`, `cfg/{secret,other}`. */
  function realHome(dir: string): string {
    const home = join(dir, "home");
    mkdirSync(join(home, "kept"), { recursive: true });
    mkdirSync(join(home, "cfg"));
    writeFileSync(join(home, ".proofrc"), "ada\n");
    symlinkSync(".proofrc", join(home, ".alias"));
    writeFileSync(join(home, "kept", "untouched"), "kept\n");
    writeFileSync(join(home, "cfg", "secret"), "s\n");
    writeFileSync(join(home, "cfg", "other"), "other\n");
    return home;
  }

  function homeFixture() {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 2;\n", [TEST.path]: PROBE });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("a", 2) });
    const home = realHome(f.dir);
    const out = join(f.dir, "seen.json");
    return { f, a, home, out, env: { ...process.env, HOME: home, PROOF_OUT: out } };
  }

  it("B1: the own HOME reaches no real HOME file, by `..` or alias, and keeps the hidden path out of a kept folder", async () => {
    const { f, a, home, out, env } = homeFixture();
    const args = {
      files: [TEST.path],
      base: a,
      case: "dependency" as const,
      without: [join(home, ".proofrc"), join(home, "cfg", "secret")],
      homeKeep: [join(home, "kept"), join(home, "cfg")],
    };
    const result = await prove(f, args, undefined, env);
    expect(result.code, result.why).toBe(0);
    expect(result.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail", runs: 1 } });
    expect(result.report.conditions.homeKeep).toEqual([join(home, "kept"), join(home, "cfg")]);
    // What the old test saw: no hidden file by any path, the kept copies, nothing else.
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
      direct: null,
      via: null,
      alias: null,
      kept: "kept\n",
      secret: null,
      other: "other\n",
    });
    // Its writes and deletes changed nothing in the real HOME.
    expect(readFileSync(join(home, ".proofrc"), "utf8")).toBe("ada\n");
    expect(readFileSync(join(home, "kept", "untouched"), "utf8")).toBe("kept\n");
    expect(readFileSync(join(home, "cfg", "secret"), "utf8")).toBe("s\n");
    expect(readFileSync(join(home, "cfg", "other"), "utf8")).toBe("other\n");
    expect(lstatSync(join(home, ".alias")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, ".alias"))).toBe(".proofrc");
    clean(f);
  });

  it("B1: refuses a kept folder that holds a link, and --home-keep with nothing hidden under HOME (exit 2)", async () => {
    const { f, a, home, env } = homeFixture();
    symlinkSync("../.proofrc", join(home, "kept", "link"));
    const base = { files: [TEST.path], base: a, case: "dependency" as const };
    const cases = [
      [
        { without: [join(home, ".proofrc")], homeKeep: [join(home, "kept")] },
        `--home-keep ${join(home, "kept")}: ~/kept/link is a link; a kept path must hold none`,
      ],
      [
        { env: [{ name: "X", value: null }], homeKeep: [join(home, "cfg")] },
        `--home-keep ${join(home, "cfg")} needs a --without path under HOME`,
      ],
    ] as const;
    for (const [extra, line] of cases) {
      const result = await prove(f, { ...base, ...extra }, undefined, env);
      expect(result.code, result.why).toBe(2);
      expect(result.err.trim().split("\n")).toEqual([`squeal proof: ${line}`]);
      clean(f);
    }
    expect(readFileSync(join(home, ".proofrc"), "utf8")).toBe("ada\n");
  });
});
