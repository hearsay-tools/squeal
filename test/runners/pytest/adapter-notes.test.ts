import { existsSync, realpathSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendNote, readDaemonNotes } from "../../../src/core/notes.js";
import type { AbsolutePath, PytestProject } from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import type { Clock } from "../../../src/runners/pytest/adapter-environment.js";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../../helpers/pytest-env.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/*
 * Task 007-39 (lessons.md defect 11): D2's state notes and "its Python
 * environment is ready" carry the topic `pytest-environment:<project>`, so
 * the note store keeps the latest of them and status drops "no Python
 * environment" once the environment is ready, and lists it again when the
 * environment goes away.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 120_000 } as const;
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};

/** A simulated clock: admission's waits cost nothing. */
const clock = (): Clock => {
  let now = 0;
  return {
    now: () => now,
    async sleep(ms) {
      now += ms;
    },
  };
};

describe.each(PYTHONS)("pytest adapter environment notes under Python %s (007-39)", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  beforeAll(() => {
    synced = syncFixture(small, version);
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
  });

  it("status drops the no-environment note once the environment is ready", SLOW, async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    const venv = join(root, ".venv");
    const aside = join(root, "..", "venv-aside");
    // The note store as the daemon keeps it, which status lists.
    const store = open(fakeCommonDir());
    let at = 0;
    const listed = () =>
      readDaemonNotes(store, "wt")
        .map((n) => n.text)
        .filter((text) => /Python environment/.test(text));
    renameSync(venv, aside);
    try {
      const adapter = await createPytestAdapter(PROJECT, {
        root,
        source: fixture.env,
        note: (text, topic) => {
          const note = {
            at: at++,
            revision: null,
            text,
            ...(topic === undefined ? {} : { topic }),
          };
          appendNote(store, "wt", note);
        },
        cacheDir: join(root, "..", "cache") as AbsolutePath,
        clock: clock(),
      });
      expect(listed()).toEqual([expect.stringMatching(/no Python environment.*uv sync/)]);

      renameSync(aside, venv);
      await adapter.invalidate([{ path: ".venv/pyvenv.cfg", kind: "add" }]);
      expect(listed()).toEqual(['pytest project "small": its Python environment is ready']);

      renameSync(venv, aside);
      await adapter.invalidate([{ path: ".venv/pyvenv.cfg", kind: "delete" }]);
      expect(listed()).toEqual([expect.stringMatching(/no Python environment.*uv sync/)]);
      await adapter.close();
    } finally {
      if (existsSync(aside)) renameSync(aside, venv);
    }
  });
});
