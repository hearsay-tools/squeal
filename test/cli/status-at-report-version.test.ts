import { describe, expect, it } from "vitest";
import { asItWasText } from "../../src/cli/status-at-report-files.js";
import { fixture, git, ref, write } from "../commit/at-keys-fixture.js";
import { SLOW } from "../daemon/helpers.js";
import { run, testOf } from "./status-at-kit.js";
import { realCommitDaemon } from "./status-at-real-daemon.js";

/*
 * Row 023-73 (dogfood round 9 Y3: 2 of 10 s2 agents, rounds 7 and 8 one
 * each, read the commit side's result of the changed test file as a run of
 * the working tree's version: "the new tests passing at both commits").
 * When a named test file differs between the commit and the working tree,
 * its line says the commit side ran the file as it was at the commit; an
 * unchanged file's line does not. A real commit daemon runs both.
 */

const CHANGED = ref("test/changed.test.ts");
const SAME = ref("test/same.test.ts");

type Side = { state: string; changedSince?: true };
const atOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === path)?.at;
const lineOf = (out: string, path: string) =>
  out.split("\n").find((line) => line.startsWith(`${path}: `));

describe(
  "the per-file line says which version of a changed test file ran at the commit (row 023-73)",
  SLOW,
  () => {
    it("marks the changed test file's commit side, and not the unchanged one's", {
      timeout: 240_000,
    }, async () => {
      const f = fixture({
        "squeal.config.json": "{}\n",
        "src/changed.ts": "export const value = 1;\n",
        "src/same.ts": "export const value = 1;\n",
        [CHANGED.path]: testOf("changed", 1),
        [SAME.path]: testOf("same", 1),
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      // The change adds a test to one file and edits the other's source only.
      f.commit({
        [CHANGED.path]: `${testOf("changed", 1)}it("new", () => expect(1).toBe(1));\n`,
        "src/same.ts": "export const value = 1; // b\n",
      });
      const real = realCommitDaemon(f.root);
      const options = { cacheRoot: f.cacheRoot, daemons: real.daemons };
      const paths = [CHANGED.path, SAME.path];
      const ask = { commit: a, paths, run: { allMissing: false }, waitMs: 120_000 } as const;

      const json = await run(f, { ...ask, json: true }, options);
      expect(atOf(json.out, CHANGED.path), json.err).toMatchObject({
        state: "pass",
        changedSince: true,
      });
      expect(atOf(json.out, SAME.path), json.err).toMatchObject({ state: "pass" });
      expect(atOf(json.out, SAME.path)?.changedSince).toBeUndefined();

      const text = await run(f, ask, options);
      const at = a.slice(0, 9);
      expect(lineOf(text.out, CHANGED.path), text.out).toContain(
        `(at ${at}: ${asItWasText(at)}; run in the commit's worktree`,
      );
      expect(lineOf(text.out, SAME.path), text.out).toContain(
        `(at ${at}: run in the commit's worktree`,
      );

      // An uncommitted edit of the unchanged file counts too: the working tree is the other side.
      write(f.root, { [SAME.path]: `${testOf("same", 1)}// edited\n` });
      const dirty = await run(f, { ...ask, json: true }, options);
      expect(atOf(dirty.out, SAME.path), dirty.err).toMatchObject({ changedSince: true });
    });
  },
);
