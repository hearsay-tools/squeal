import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearScratch } from "../../evals/lib/index.mjs";
import { cellDirs, type FakeRoot, fakeRoot, removeRoot, runCell, TOKEN } from "./fake-cell.js";

// Review 006-07 B1, with made-up tokens only: the scan and the removal follow one policy, so
// nothing retained under `work/` or `out/` escapes the scan, whatever its depth. Each check reads
// the bytes left on disk, not only the report.
const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-evals-nested-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    execFileSync("chmod", ["-R", "u+rwx", d]);
    rmSync(d, { recursive: true, force: true });
  }
});

const SECRETS = [TOKEN, TOKEN.slice(-20)];
const write = (d: string, p: string, s: string) => {
  mkdirSync(join(d, p, ".."), { recursive: true });
  writeFileSync(join(d, p), s);
};

/** Every path under `dir` whose own bytes (a file's content, a link's target) hold a secret. */
function onDisk(dir: string): string[] {
  const out: string[] = [];
  const visit = (p: string) => {
    const st = lstatSync(p);
    const bytes = st.isSymbolicLink()
      ? readlinkSync(p)
      : st.isFile()
        ? readFileSync(p, "latin1")
        : null;
    if (st.isDirectory()) for (const e of readdirSync(p)) visit(join(p, e));
    else if (bytes !== null && SECRETS.some((s) => bytes.includes(s)))
      out.push(p.slice(dir.length + 1));
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

describe("clearScratch on nested evidence (B1)", () => {
  it("removes a token in a nested node_modules from disk, not only from the report", () => {
    const cell = scratch();
    write(cell, "work/packages/a/node_modules/leak.txt", `token ${TOKEN}\n`);
    write(cell, "work/packages/a/index.ts", "export {};\n");
    const r = clearScratch(cell, SECRETS);
    expect(onDisk(cell)).toEqual([]);
    expect(existsSync(join(cell, "work/packages/a/node_modules"))).toBe(false);
    expect(readFileSync(join(cell, "work/packages/a/index.ts"), "utf8")).toBe("export {};\n");
    expect(r.secretsBeforeRemoval).toEqual(["work/packages/a/node_modules/leak.txt"]);
    expect(r.secretsAfterRemoval).toEqual([]);
  });

  it("removes every node_modules and .git/objects at any depth of work/ and out/", () => {
    const cell = scratch();
    for (const p of [
      "out/node_modules/leak.txt",
      "out/harness/x/node_modules/y/leak.txt",
      "work/a/b/c/node_modules/@s/p/leak.txt",
      "work/packages/b/.git/objects/ab/cdef",
    ])
      write(cell, p, TOKEN);
    write(cell, "work/packages/b/.git/HEAD", "ref: refs/heads/main\n");
    const r = clearScratch(cell, SECRETS);
    expect(onDisk(cell)).toEqual([]);
    for (const p of [
      "out/node_modules",
      "out/harness/x/node_modules",
      "work/a/b/c/node_modules",
      "work/packages/b/.git/objects",
    ])
      expect(existsSync(join(cell, p))).toBe(false);
    expect(existsSync(join(cell, "work/packages/b/.git/HEAD"))).toBe(true);
    expect(r.secretsAfterRemoval).toEqual([]);
  });

  it("fails the cell when a nested dependency directory cannot be removed: it is scanned", () => {
    const cell = scratch();
    write(cell, "work/packages/a/node_modules/leak.txt", TOKEN);
    chmodSync(join(cell, "work/packages/a/node_modules/leak.txt"), 0o444);
    chmodSync(join(cell, "work/packages/a/node_modules"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(r.secretsAfterRemoval).toEqual(["work/packages/a/node_modules/leak.txt"]);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("fails the cell on a retained directory it cannot read", () => {
    const cell = scratch();
    write(cell, "work/sealed/leak.txt", TOKEN);
    chmodSync(join(cell, "work/sealed"), 0o000);
    const r = clearScratch(cell, SECRETS);
    expect(r.secretsAfterRemoval).toEqual(["work/sealed"]);
  });

  it("keeps no link in retained evidence and never writes through one", () => {
    const cell = scratch();
    const outside = scratch();
    write(outside, "node_modules/leak.txt", TOKEN);
    write(cell, "work/src/a.ts", "export {};\n");
    mkdirSync(join(cell, "out"));
    symlinkSync(join(outside, "node_modules"), join(cell, "work/deps"));
    symlinkSync(join(outside, "node_modules/leak.txt"), join(cell, "out/leak.txt"));
    symlinkSync(TOKEN, join(cell, "out/named"));
    symlinkSync(join(cell, "work"), join(cell, "work/src/loop"));
    const r = clearScratch(cell, SECRETS);
    expect(onDisk(cell)).toEqual([]);
    for (const p of ["work/deps", "out/leak.txt", "out/named", "work/src/loop"])
      expect(() => lstatSync(join(cell, p))).toThrow();
    expect(readFileSync(join(outside, "node_modules/leak.txt"), "utf8")).toBe(TOKEN);
    expect(readFileSync(join(cell, "work/src/a.ts"), "utf8")).toBe("export {};\n");
    expect(r.secretsAfterRemoval).toEqual([]);
  });

  it("redacts a hard-linked file without writing through to its other name", () => {
    const cell = scratch();
    const outside = scratch();
    write(outside, "kept.txt", `token ${TOKEN}\n`);
    mkdirSync(join(cell, "work"));
    linkSync(join(outside, "kept.txt"), join(cell, "work/linked.txt"));
    const r = clearScratch(cell, SECRETS);
    expect(readFileSync(join(cell, "work/linked.txt"), "utf8")).toBe("token [redacted]\n");
    expect(readFileSync(join(outside, "kept.txt"), "utf8")).toBe(`token ${TOKEN}\n`);
    expect(r.sanitized).toEqual(["work/linked.txt"]);
  });
});

// The runner's half: a session writes the token into a nested dependency directory.
const NESTED_HARNESS = `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
echo $$ >> "$FAKE_LOG/harness"
mkdir -p packages/a/node_modules
echo "token $ANTHROPIC_AUTH_TOKEN" > packages/a/node_modules/leak.txt
if [ "$FAKE_NESTED" = locked ]; then
  chmod 444 packages/a/node_modules/leak.txt; chmod 555 packages/a/node_modules
fi
exit 0
`;
const roots: FakeRoot[] = [];
const root = () => {
  const f = fakeRoot();
  roots.push(f);
  writeFileSync(join(f.dir, "bin/claude"), NESTED_HARNESS);
  return f;
};
afterEach(() => {
  for (const f of roots.splice(0)) removeRoot(f);
});
const ARGS = ["t1-thousands", "p0", "claude", "claude-haiku-5-5", "1"];

describe("run-cell.mjs with a token in a nested node_modules (B1)", { timeout: 30_000 }, () => {
  it("removes it from disk and keeps the grade", async () => {
    const f = root();
    const r = await runCell(f, ARGS);
    expect(r.output).not.toContain(TOKEN);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(onDisk(f.root)).toEqual([]);
    expect(existsSync(join(cell, "work/packages/a/node_modules"))).toBe(false);
    expect(r.code).toBe(0);
    expect(existsSync(join(cell, "out/grade.json"))).toBe(true);
  });

  it("fails the cell and drops the grade when the token survives there", async () => {
    const f = root();
    const r = await runCell(f, ARGS, { FAKE_NESTED: "locked" });
    expect(r.output).not.toContain(TOKEN);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(onDisk(cell)).toEqual(["work/packages/a/node_modules/leak.txt"]);
    expect(r.code).toBe(1);
    expect(existsSync(join(cell, "out/grade.json"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(cell, "out/scratch.json"), "utf8")).secretsAfterRemoval,
    ).toEqual(["work/packages/a/node_modules/leak.txt"]);
  });
});
