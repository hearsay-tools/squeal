import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cellDirs, type FakeRoot, fakeRoot, removeRoot, runCell, survivors } from "./fake-cell.js";

// Row 006-100 through the real run-cell.mjs, with fake harnesses and a fake Squeal: a Codex pin
// from 0.1.368 on runs its commit's runtime as a fresh install selects it, and a pin with no
// CLI for the cell's harness stops the cell before any session, naming what is missing.
const roots: FakeRoot[] = [];
const root = () => {
  const f = fakeRoot();
  roots.push(f);
  return f;
};
afterEach(() => {
  for (const f of roots.splice(0)) removeRoot(f);
});
const CELL = ["t1-thousands", "p0"];
const CLI = "dist/cli/squeal.mjs";
const base = (f: FakeRoot) => join(f.root, "pin-base", f.commit);
const write = (p: string, s: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
};
const lines = (p: string) =>
  existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
/** Each fake Squeal command the cell ran, in order: `init`, `start`, `run`, ... */
const squealCalls = (f: FakeRoot) => lines(join(f.log, "squeal")).map((l) => JSON.parse(l).args[0]);

/**
 * The fake root's pin in the layout of e34c9bc1f on: the Codex plugin a fixed adapter, its seed a
 * CLI that must not run, and the fake Squeal moved to `plugins/codex-runtime` at 0.1.387, where
 * it logs the path it runs from.
 */
function newLayout(f: FakeRoot) {
  const pin = base(f);
  const fake = readFileSync(join(pin, "plugins/codex", CLI), "utf8");
  rmSync(join(pin, "plugins/codex/dist"), { recursive: true });
  write(join(pin, "plugins/codex/hooks/hooks.json"), "{}");
  for (const [dir, version] of [
    ["plugins/codex/seed", "0.1.368"],
    ["plugins/codex-runtime", "0.1.387"],
  ] as const) {
    write(join(pin, dir, "runtime.json"), JSON.stringify({ schema: 1, version, files: {} }));
    write(join(pin, dir, ".codex-plugin/plugin.json"), JSON.stringify({ name: "squeal", version }));
  }
  write(
    join(pin, "plugins/codex/seed", CLI),
    'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.FAKE_LOG + "/seed", "ran\\n");\nprocess.exit(1);\n',
  );
  write(
    join(pin, "plugins/codex-runtime", CLI),
    `import { appendFileSync as logPath } from "node:fs";\nlogPath(process.env.FAKE_LOG + "/cli", process.argv[1] + "\\n");\n${fake}`,
  );
}

describe("run-cell.mjs on a pin's Squeal CLI (row 006-100)", { timeout: 30_000 }, () => {
  it("runs a Codex cell on the commit's runtime, retained as a fresh install selects it", async () => {
    const f = root();
    newLayout(f);
    // A Codex that installs, trusts and runs a session as the fake Claude Code does.
    copyFileSync(join(f.dir, "bin/claude"), join(f.dir, "bin/codex"));
    const r = await runCell(f, [...CELL, "codex", "gpt-6-luna", "1"], { FAKE_HARNESS: "squeal" });
    expect(r.code, r.output).toBe(0);
    const [cell] = cellDirs(f);
    if (!cell) throw new Error("no cell");
    const retained = join(cell, "codex/plugins/data/squeal-hearsay/versions/0.1.387", CLI);
    // The trust step, the warm-up, the session's bare squeal and the end status: one CLI.
    expect(squealCalls(f)).toEqual(
      expect.arrayContaining(["init", "start", "run", "--version", "status", "stop"]),
    );
    expect([...new Set(lines(join(f.log, "cli")))]).toEqual([retained]);
    expect(lines(join(f.log, "bare")).length).toBeGreaterThan(0);
    expect(new Set(lines(join(f.log, "bare")))).toEqual(new Set(["Known failures: 0"]));
    expect(existsSync(join(f.log, "seed"))).toBe(false);
    expect(readFileSync(join(cell, "out/runner.log"), "utf8")).toContain("squeal cells/");
    expect(survivors(f, ["daemons"])).toEqual([]);
  });

  it.each([
    [
      "claude",
      "claude-haiku-5-5",
      (f: FakeRoot) => rmSync(join(base(f), "plugins/claude-code", CLI)),
    ],
    ["codex", "gpt-6-luna", (f: FakeRoot) => rmSync(join(base(f), "plugins/codex", CLI))],
    [
      "codex",
      "gpt-6-luna",
      (f: FakeRoot) => {
        newLayout(f);
        rmSync(join(base(f), "plugins/codex-runtime", CLI));
      },
    ],
  ] as const)(
    "stops a %s cell whose pin has no CLI before any session (case %#)",
    async (harness, model, breakIt) => {
      const f = root();
      breakIt(f);
      copyFileSync(join(f.dir, "bin/claude"), join(f.dir, "bin/codex"));
      const r = await runCell(f, [...CELL, harness, model, "1"]);
      expect(r.code).toBe(1);
      expect(r.output).toMatch(
        new RegExp(`cell failed: missing pinned Squeal CLI for ${harness}: `),
      );
      expect(existsSync(join(f.log, "harness"))).toBe(false);
      expect(squealCalls(f)).toEqual([]);
      const [cell] = cellDirs(f);
      if (!cell) throw new Error("no cell");
      expect(existsSync(join(cell, "out/grade.json"))).toBe(false);
    },
  );
});
