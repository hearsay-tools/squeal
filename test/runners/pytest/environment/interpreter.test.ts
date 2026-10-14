import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { queryInterpreter } from "../../../../src/runners/pytest/environment/interpreter.js";
import { link, tempDir } from "./tree.js";

/*
 * Spec 007 D2: "the interpreter's real path, `sys.version`, implementation
 * and cache tag, asked once with `-I -S` (16 ms) and again when the
 * binary's stat changes".
 */

/** `python3` on this machine's PATH, for the live query; `null` skips it. */
const python3 = (() => {
  try {
    return execFileSync("sh", ["-c", "command -v python3"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
})();

/** A shell script standing in for an interpreter: prints `answer`, counts its runs in `<dir>/runs`. */
function fake(dir: string, answer: string): string {
  const path = join(dir, "python");
  writeFileSync(
    path,
    `#!/bin/sh\necho "$@" >> "${dir}/args"\necho x >> "${dir}/runs"\necho '${answer}'\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

const runs = (dir: string) => readFileSync(join(dir, "runs"), "utf8").split("\n").length - 1;

describe("queryInterpreter (spec 007 D2)", () => {
  it.skipIf(python3 === null)(
    "asks python3 for its version, implementation and cache tag (skipped: no python3 on PATH)",
    async () => {
      const dir = tempDir();
      link(python3 as string, join(dir, "bin", "python"));
      const answer = await queryInterpreter(join(dir, "bin", "python"));
      expect(answer).toEqual({
        ok: true,
        realPath: realpathSync(python3 as string),
        version: expect.stringMatching(/^3\.\d+\.\d+/),
        implementation: "cpython",
        cacheTag: expect.stringMatching(/^cpython-3\d+$/),
      });
    },
  );

  it("passes -I -S and asks again only when the binary's stat changes", async () => {
    const dir = tempDir();
    const python = fake(dir, '["3.13.14 (main)", "cpython", "cpython-313"]');
    const first = await queryInterpreter(python);
    expect(first).toEqual({
      ok: true,
      realPath: python,
      version: "3.13.14 (main)",
      implementation: "cpython",
      cacheTag: "cpython-313",
    });
    expect(readFileSync(join(dir, "args"), "utf8")).toMatch(/^-I -S -c /);
    expect(await queryInterpreter(python)).toEqual(first);
    expect(runs(dir)).toBe(1);
    fake(dir, '["3.13.15 (main, rebuilt)", "cpython", "cpython-313"]');
    expect(await queryInterpreter(python)).toMatchObject({ version: "3.13.15 (main, rebuilt)" });
    expect(runs(dir)).toBe(2);
  });

  it("follows links to the real path and caches by it", async () => {
    const dir = tempDir();
    const real = fake(dir, '["3.10.20", "cpython", "cpython-310"]');
    link(real, join(dir, "a/bin/python"));
    link(real, join(dir, "b/bin/python"));
    expect(await queryInterpreter(join(dir, "a/bin/python"))).toMatchObject({ realPath: real });
    expect(await queryInterpreter(join(dir, "b/bin/python"))).toMatchObject({ realPath: real });
    expect(runs(dir)).toBe(1);
  });

  it("reports a missing or broken interpreter without caching it", async () => {
    const dir = tempDir();
    expect(await queryInterpreter(join(dir, "missing"))).toMatchObject({
      ok: false,
      error: expect.stringContaining(`cannot run ${join(dir, "missing")}`),
    });
    const broken = fake(dir, "not json");
    expect(await queryInterpreter(broken)).toMatchObject({
      ok: false,
      error: expect.stringContaining('unexpected output "not json\\n"'),
    });
    await queryInterpreter(broken);
    expect(runs(dir)).toBe(2);
  });
});
