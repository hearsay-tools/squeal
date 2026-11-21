import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";
import { realCommitDaemon } from "./status-at-real-daemon.js";

/** The production commit worktree functions; a red control drops `check`. */
const worktrees = {};

/*
 * Row 023-18 D3 (`tasks/023-09-notes.md`): squawk's `packages/mobile` held
 * `android/gradlew.bat text eol=crlf`, so git's own checkout writes CRLF over
 * the LF blob before any install. The checkout still differs from the commit
 * and nothing is stored, but the report says git's checkout rules changed the
 * path, not the install.
 */

const TEST = ref("test/a.test.ts");

describe(
  "a checkout git's own rules change is not blamed on the install (row 023-18 D3)",
  SLOW,
  () => {
    it("names the path and git's checkout rules, in text and JSON", {
      timeout: 120_000,
    }, async () => {
      const f = fixture({
        "squeal.config.json": "{}\n",
        ".gitattributes": "*.bat text eol=crlf\n",
        "tools/run.bat": "@echo off\necho run\n",
        "src/a.ts": "export const value = 1;\n",
        [TEST.path]: testOf("a", 1),
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      f.commit({ [TEST.path]: `${testOf("a", 1)}// HEAD\n` });
      const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };

      const text = await run(f, { commit: a }, options);
      expect(text.out, text.err).toContain(
        `Git's checkout rules (.gitattributes) wrote tools/run.bat otherwise than ${a.slice(0, 9)} holds it`,
      );
      expect(text.out).toContain("not comparable (git's checkout rules changed tools/run.bat)");
      expect(text.out).not.toContain("install changed");
      clean(f);

      // Row 023-40 and 023-40c: the commit daemon checks its tree against the commit before its
      // install; git's rules changed it, so it runs nothing and the file stays not comparable.
      const real = realCommitDaemon(f.root, worktrees);
      const json = await run(
        f,
        { commit: a, json: true, run: { allMissing: false }, waitMs: 60_000 },
        { cacheRoot: f.cacheRoot, daemons: real.daemons },
      );
      const report = JSON.parse(json.out);
      expect(report, json.err).toMatchObject({ changed: "tools/run.bat", changedBy: "git" });
      expect(real.started).toHaveLength(1);
      expect(report.run).toMatchObject({ commit: { files: 0 } });
      const [row] = report.files;
      expect(row.at).toEqual({
        state: "not comparable",
        reason: "git's checkout rules changed tools/run.bat",
      });
    });
  },
);
