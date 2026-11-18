import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, link, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";

/*
 * Review wave-9 B2 and B3 (row 023-11), on `$TMPDIR` git fixtures with the
 * real Vitest adapter; every command's `HOME` is a throwaway folder.
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
      expect(result.code).toBe(2);
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
    expect(result.code, result.err).toBe(1);
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
      expect(result.code, result.err).toBe(3);
      expect(result.files[0]).toMatchObject({
        verdict: "not comparable",
        reason: "install changed the checkout: config; the condition is not known to hold",
        red: { end: "unknown", from: null, runs: 0 },
      });
      expect(result.report.runs).toBe(0);
      clean(f);
    },
  );
});
