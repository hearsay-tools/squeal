import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeRunner } from "../../evals/lib/index.mjs";
import { evalsRoot, refuseInsideRepo, repoAncestor } from "../../evals/lib/root.mjs";

// 006-42, from 001's R4: the cells and the judge's scratch sit outside every repository, so no
// Claude cell or judge call loads a repository's CLAUDE.md, AGENTS.md or .claude.
const checkout = resolve(import.meta.dirname, "../..");

describe("the eval root", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("defaults to a per-user directory under /tmp with no repository above it", () => {
    const root = evalsRoot({});
    expect(root).toBe(`/tmp/squeal-evals-${process.getuid?.()}`);
    expect(repoAncestor(root)).toBeNull();
    expect(refuseInsideRepo(root)).toBe(root);
  });

  it("never follows TMPDIR, which a Cezar session points inside the checkout", () => {
    expect(evalsRoot({ TMPDIR: join(checkout, ".ai/cezar/tmp/x") })).toBe(evalsRoot({}));
  });

  it("takes SQ_EVALS_ROOT over the default", () => {
    expect(evalsRoot({ SQ_EVALS_ROOT: "/tmp/elsewhere/evals" })).toBe("/tmp/elsewhere/evals");
    expect(evalsRoot({ SQ_EVALS_ROOT: "rel" })).toBe(resolve("rel"));
  });

  it("refuses a root inside this checkout, and accepts it with force", () => {
    const inside = join(checkout, ".ai/cezar/tmp/task/squeal-evals");
    expect(repoAncestor(inside)?.dir).toBe(checkout);
    expect(() => refuseInsideRepo(inside)).toThrow(/inside a repository.*--force-root/);
    expect(refuseInsideRepo(inside, { force: true })).toBe(inside);
  });

  it.each(["CLAUDE.md", "AGENTS.md", ".claude", ".git"])(
    "refuses a root below a directory holding %s",
    (marker) => {
      const top = mkdtempSync("/tmp/squeal-evals-root-test-");
      made.push(top);
      if (marker.endsWith(".md")) writeFileSync(join(top, marker), "");
      else mkdirSync(join(top, marker));
      const root = join(top, "a", "b");
      expect(repoAncestor(root)).toEqual({ dir: top, marker });
      expect(() => refuseInsideRepo(root)).toThrow(marker);
    },
  );
});

describe("the root's users", () => {
  it("the judge's default runner refuses a root inside this checkout", () => {
    const saved = process.env.SQ_EVALS_ROOT;
    process.env.SQ_EVALS_ROOT = join(checkout, ".ai/cezar/tmp/task/squeal-evals");
    try {
      expect(() => claudeRunner()).toThrow(/inside a repository/);
    } finally {
      if (saved === undefined) delete process.env.SQ_EVALS_ROOT;
      else process.env.SQ_EVALS_ROOT = saved;
    }
  });

  // The bins run as soon as they are imported, so their wiring is read, not run.
  it.each(["run-baseline.mjs", "run-cell.mjs", "judge-calibrate.mjs"])(
    "%s takes its root from lib/root.mjs, never the system temp directory",
    (file) => {
      const source = readFileSync(join(checkout, "evals/bin", file), "utf8");
      expect(source).toMatch(/refuseInsideRepo\(/);
      expect(source).toMatch(/evalsRoot\(\)/);
      expect(source).toMatch(/--force-root|"force-root"/);
      expect(source).not.toMatch(/tmpdir\(\)/);
    },
  );
});
