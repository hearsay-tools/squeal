import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearScratch } from "../../evals/lib/index.mjs";
import { cellDirs, type FakeRoot, fakeRoot, removeRoot, runCell, TOKEN } from "./fake-cell.js";

// Review 006-09 B1, with made-up tokens only: a link that survives cleanup is retained evidence
// the scan cannot vouch for, whatever its target holds, so it fails the cell. The link's target is
// never followed or changed. Each check looks at what is left on disk, not only at the report.
const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "squeal-evals-link-"));
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
const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const exists = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/** A cell with an outside file holding the token, linked from `work/<at>`. */
function linkedCell(at: string, target: "file" | "dir" = "file") {
  const cell = scratch();
  const outside = scratch();
  writeFileSync(join(outside, "leak.txt"), `token ${TOKEN}\n`);
  mkdirSync(join(cell, "work", at, ".."), { recursive: true });
  symlinkSync(target === "file" ? join(outside, "leak.txt") : outside, join(cell, "work", at));
  return { cell, outside };
}

describe("clearScratch with a link that survives removal (B1)", () => {
  it("fails the cell on a link in a non-writable directory, its target untouched", () => {
    const { cell, outside } = linkedCell("packages/a/locked/leak.txt");
    chmodSync(join(cell, "work/packages/a/locked"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(isLink(join(cell, "work/packages/a/locked/leak.txt"))).toBe(true);
    expect(r.secretsAfterRemoval).toEqual(["work/packages/a/locked/leak.txt"]);
    expect(readFileSync(join(outside, "leak.txt"), "utf8")).toBe(`token ${TOKEN}\n`);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("fails the cell on a surviving link to a directory", () => {
    const { cell, outside } = linkedCell("locked/deps", "dir");
    chmodSync(join(cell, "work/locked"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(r.secretsAfterRemoval).toEqual(["work/locked/deps"]);
    expect(readFileSync(join(outside, "leak.txt"), "utf8")).toBe(`token ${TOKEN}\n`);
  });

  it("fails the cell on a link inside a nested node_modules that cannot be removed", () => {
    const { cell } = linkedCell("packages/a/node_modules/x/leak.txt");
    chmodSync(join(cell, "work/packages/a/node_modules/x"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(isLink(join(cell, "work/packages/a/node_modules/x/leak.txt"))).toBe(true);
    expect(r.secretsAfterRemoval).toEqual(["work/packages/a/node_modules/x/leak.txt"]);
  });

  it("removes a FIFO from retained evidence, and fails the cell when one survives", () => {
    const cell = scratch();
    mkdirSync(join(cell, "work/locked"), { recursive: true });
    mkdirSync(join(cell, "out"));
    execFileSync("mkfifo", [join(cell, "out/pipe"), join(cell, "work/locked/pipe")]);
    chmodSync(join(cell, "work/locked"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(exists(join(cell, "out/pipe"))).toBe(false);
    expect(r.secretsAfterRemoval).toEqual(["work/locked/pipe"]);
  });

  it("fails the cell on a socket that survives", () => {
    const cell = scratch();
    mkdirSync(join(cell, "work/locked"), { recursive: true });
    // Bound by a relative name: a socket's path is limited to about a hundred bytes.
    const made = spawnSync(
      "python3",
      ["-I", "-c", "import socket; socket.socket(socket.AF_UNIX).bind('s.sock')"],
      { cwd: join(cell, "work/locked"), encoding: "utf8" },
    );
    expect(made.status, made.stderr).toBe(0);
    chmodSync(join(cell, "work/locked"), 0o555);
    const r = clearScratch(cell, SECRETS);
    expect(r.secretsAfterRemoval).toEqual(["work/locked/s.sock"]);
  });

  it("removes an ordinary link and passes the cell, its target untouched", () => {
    const { cell, outside } = linkedCell("packages/a/leak.txt");
    writeFileSync(join(cell, "work/packages/a/index.ts"), "export {};\n");
    const r = clearScratch(cell, SECRETS);
    expect(exists(join(cell, "work/packages/a/leak.txt"))).toBe(false);
    expect(readFileSync(join(cell, "work/packages/a/index.ts"), "utf8")).toBe("export {};\n");
    expect(readFileSync(join(outside, "leak.txt"), "utf8")).toBe(`token ${TOKEN}\n`);
    expect(r.secretsAfterRemoval).toEqual([]);
  });
});

// The runner's half: a session links a file outside the cell that holds the token.
const LINK_HARNESS = `#!/bin/sh
[ "$1" = "--version" ] && { echo "fake 1.0"; exit 0; }
echo $$ >> "$FAKE_LOG/harness"
echo "token $ANTHROPIC_AUTH_TOKEN" > "$FAKE_OUTSIDE/leak.txt"
mkdir -p packages/a/locked
ln -s "$FAKE_OUTSIDE/leak.txt" packages/a/locked/leak.txt
[ "$FAKE_LINK" = locked ] && chmod 555 packages/a/locked
exit 0
`;
const roots: FakeRoot[] = [];
const root = () => {
  const f = fakeRoot();
  roots.push(f);
  writeFileSync(join(f.dir, "bin/claude"), LINK_HARNESS);
  mkdirSync(join(f.dir, "outside"));
  return f;
};
afterEach(() => {
  for (const f of roots.splice(0)) removeRoot(f);
});
const ARGS = ["t1-thousands", "p0", "claude", "claude-haiku-5-5", "1"];
const LINK = "work/packages/a/locked/leak.txt";

describe("run-cell.mjs with a link to a file holding the token (B1)", { timeout: 30_000 }, () => {
  it("removes an ordinary link and keeps the grade", async () => {
    const f = root();
    const outside = join(f.dir, "outside");
    const r = await runCell(f, ARGS, { FAKE_OUTSIDE: outside });
    expect(r.output).not.toContain(TOKEN);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(exists(join(cell, LINK))).toBe(false);
    expect(r.code).toBe(0);
    expect(existsSync(join(cell, "out/grade.json"))).toBe(true);
    expect(readFileSync(join(outside, "leak.txt"), "utf8")).toBe(`token ${TOKEN}\n`);
  });

  it("fails the cell and drops the grade when the link cannot be removed", async () => {
    const f = root();
    const outside = join(f.dir, "outside");
    const r = await runCell(f, ARGS, { FAKE_OUTSIDE: outside, FAKE_LINK: "locked" });
    expect(r.output).not.toContain(TOKEN);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    expect(isLink(join(cell, LINK))).toBe(true);
    expect(r.code).toBe(1);
    expect(existsSync(join(cell, "out/grade.json"))).toBe(false);
    const report = JSON.parse(readFileSync(join(cell, "out/scratch.json"), "utf8"));
    expect(report.secretsAfterRemoval).toEqual([LINK]);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
    expect(readFileSync(join(outside, "leak.txt"), "utf8")).toBe(`token ${TOKEN}\n`);
  });
});
