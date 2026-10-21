import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Metafile } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleOptions, REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { tempDir } from "../store/helpers.js";

/*
 * Spec 014 goal 6 (row 014-33): `squeal ps` loads only its own code. The plugin
 * build ships it as `dist/cli/ps.mjs` beside the whole CLI, and the plugins'
 * `bin/squeal` run it for `ps`.
 */

/** For tests that run esbuild over every bundle: the full suite runs several at once. */
const BUILD = { timeout: 60_000 };

describe("the ps bundle", () => {
  let outdir: string;
  let metafile: Metafile;
  // One build for the file: `tempDir` would remove it after the first test.
  beforeAll(async () => {
    outdir = mkdtempSync(join(tmpdir(), "squeal-ps-bundle-"));
    const result = await build(bundleOptions(outdir));
    metafile = result.metafile as Metafile;
  }, BUILD.timeout);
  afterAll(() => rmSync(outdir, { recursive: true, force: true }));

  const output = (name: string) => {
    const entry = Object.entries(metafile.outputs).find(([path]) => path.endsWith(name));
    if (entry === undefined) throw new Error(`no ${name} in the build`);
    return entry[1];
  };
  const run = (name: string, args: readonly string[]) =>
    spawnSync(process.execPath, [join(outdir, "cli", name), ...args], {
      cwd: outdir,
      encoding: "utf8",
    });

  it("holds ps's code and not the rest of the CLI", () => {
    const ps = output("cli/ps.mjs");
    const inputs = Object.keys(ps.inputs);
    expect(inputs).toContain("src/cli/ps.ts");
    expect(inputs).not.toContain("src/cli/main.ts");
    expect(ps.bytes).toBeLessThan(output("cli/squeal.mjs").bytes / 8);
    expect(ps.imports.filter((i) => !isBuiltin(i.path))).toEqual([]);
  });

  it("runs squeal ps: its own usage error, exit 2", () => {
    const r = run("ps.mjs", ["ps", "--bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('squeal ps: unknown option "--bogus"');
    expect(r.stderr).toContain("usage: squeal ps [--repo] [--full] [--json]");
  });

  it.each([[["ps", "--help"]], [["ps", "--full", "-h"]], [["--version"]], [["status", "--bogus"]]])(
    "answers %j as the whole CLI does, through it",
    (args) => {
      const ps = run("ps.mjs", args);
      const whole = run("squeal.mjs", args);
      expect(whole.status).toBeTypeOf("number");
      expect(whole.stdout + whole.stderr).toMatch(/squeal|\d+\.\d+\.\d+/);
      expect({ code: ps.status, out: ps.stdout, err: ps.stderr }).toEqual({
        code: whole.status,
        out: whole.stdout,
        err: whole.stderr,
      });
    },
  );
});

describe.each([["claude-code"], ["opencode"]])("the %s plugin's bin/squeal", (plugin) => {
  /** The plugin's `bin/squeal` beside a fake `squeal.mjs` and `ps.mjs` that name themselves. */
  function fakePlugin(): string {
    const dir = tempDir("squeal-bin-");
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "dist", "cli"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "plugins", plugin, "bin", "squeal"), join(dir, "bin", "squeal"));
    chmodSync(join(dir, "bin", "squeal"), 0o755);
    for (const name of ["squeal", "ps"]) {
      writeFileSync(
        join(dir, "dist", "cli", `${name}.mjs`),
        `console.log(JSON.stringify(["${name}", ...process.argv.slice(2)]));\n`,
      );
    }
    return join(dir, "bin", "squeal");
  }
  const ran = (bin: string, args: readonly string[]) =>
    JSON.parse(execFileSync(bin, args, { encoding: "utf8" })) as string[];

  it("runs ps.mjs for ps, with every argument", () => {
    expect(ran(fakePlugin(), ["ps", "--json", "--repo"])).toEqual(["ps", "ps", "--json", "--repo"]);
  });

  it("runs squeal.mjs for every other command, and for no command", () => {
    const bin = fakePlugin();
    expect(ran(bin, ["status", "ps"])).toEqual(["squeal", "status", "ps"]);
    expect(ran(bin, [])).toEqual(["squeal"]);
  });
});
