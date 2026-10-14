import { existsSync, realpathSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendNote, readDaemonNotes } from "../../../src/core/notes.js";
import {
  type AbsolutePath,
  type DaemonNote,
  notesMetaKey,
  type PytestProject,
  type Store,
} from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import type { Clock } from "../../../src/runners/pytest/adapter-environment.js";
import {
  PYTHONS,
  type PytestEnv,
  requireSynced,
  type Synced,
  syncFixture,
} from "../../helpers/pytest-env.js";
import { fakeCommonDir, open } from "../../store/helpers.js";

/*
 * Task 007-39 (lessons.md defect 11): D2's state notes and "its Python
 * environment is ready" carry the topic `pytest-environment:<project>`, so
 * the note store keeps the latest of them and status drops "no Python
 * environment" once the environment is ready, and lists it again when the
 * environment goes away. A daemon that starts with a ready environment
 * notes it only when the topic's latest note is another one (task 007-41),
 * so a fresh start notes nothing and an older daemon's untagged ready note
 * cannot hide a later no-environment note.
 */

const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
const SLOW = { timeout: 120_000 } as const;
const PROJECT: PytestProject = {
  name: "small",
  args: [],
  env: {},
  include: ["tests/**/test_*.py"],
};

const READY = 'pytest project "small": its Python environment is ready';
const TOPIC = "pytest-environment:small";
const NO_ENVIRONMENT =
  'pytest project "small": no Python environment (looked at .venv, .pdm-python); run `uv sync` in the worktree root to create one. Its checks stay unknown until then.';

/** The daemon's note callbacks over a real note store (`daemon.ts`, `#note`). */
function daemonNotes(store: Store) {
  let at = 0;
  return {
    note: (text: string, topic?: string) =>
      appendNote(store, "wt", {
        at: at++,
        revision: null,
        text,
        ...(topic === undefined ? {} : { topic }),
      }),
    latestNote: (topic: string) =>
      readDaemonNotes(store, "wt").findLast((n) => n.topic === topic)?.text,
  };
}

const environmentNotes = (store: Store) =>
  readDaemonNotes(store, "wt")
    .map((n) => n.text)
    .filter((text) => /Python environment/.test(text));

/** The topic's stored notes, history included; the graph's own notes are not this row's. */
const ofTopic = (store: Store) =>
  (JSON.parse(store.meta.get(notesMetaKey("wt")) ?? "[]") as DaemonNote[]).filter(
    (n) => n.topic === TOPIC,
  );

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
    const listed = () => environmentNotes(store);
    renameSync(venv, aside);
    try {
      const adapter = await createPytestAdapter(PROJECT, {
        root,
        source: fixture.env,
        ...daemonNotes(store),
        cacheDir: join(root, "..", "cache") as AbsolutePath,
        clock: clock(),
      });
      expect(listed()).toEqual([expect.stringMatching(/no Python environment.*uv sync/)]);

      renameSync(aside, venv);
      await adapter.invalidate([{ path: ".venv/pyvenv.cfg", kind: "add" }]);
      expect(listed()).toEqual([READY]);

      renameSync(venv, aside);
      await adapter.invalidate([{ path: ".venv/pyvenv.cfg", kind: "delete" }]);
      expect(listed()).toEqual([expect.stringMatching(/no Python environment.*uv sync/)]);
      await adapter.close();
    } finally {
      if (existsSync(aside)) renameSync(aside, venv);
    }
  });

  /** A daemon start over `store` with the fixture's ready environment. */
  const start = async (fixture: PytestEnv, store: Store) => {
    const root = realpathSync(fixture.root) as AbsolutePath;
    const adapter = await createPytestAdapter(PROJECT, {
      root,
      source: fixture.env,
      ...daemonNotes(store),
      cacheDir: join(root, "..", "cache") as AbsolutePath,
      clock: clock(),
    });
    await adapter.close();
  };
  /** An earlier daemon's note, `topic` absent when that daemon predates topics. */
  const earlier = (store: Store, text: string, topic?: string) =>
    appendNote(store, "wt", {
      at: -1,
      revision: null,
      text,
      ...(topic === undefined ? {} : { topic }),
    });

  it("a fresh start with a ready environment notes nothing", SLOW, async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const store = open(fakeCommonDir());
    await start(fixture, store);
    expect(environmentNotes(store)).toEqual([]);
    expect(ofTopic(store)).toEqual([]);
  });

  it(
    "a start with a ready environment replaces an earlier daemon's note; a second start notes nothing",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const store = open(fakeCommonDir());
      // An earlier daemon saw no environment; the sync ran while none was running.
      earlier(store, NO_ENVIRONMENT, TOPIC);

      await start(fixture, store);
      expect(environmentNotes(store)).toEqual([READY]);
      const stored = ofTopic(store);
      expect(stored.map((n) => n.text)).toEqual([NO_ENVIRONMENT, READY]);

      await start(fixture, store);
      expect(ofTopic(store)).toEqual(stored);
      expect(environmentNotes(store)).toEqual([READY]);
    },
  );

  it(
    "an older daemon's untagged ready note does not hide a later no-environment note",
    SLOW,
    async (ctx) => {
      const fixture = requireSynced(ctx, synced);
      const store = open(fakeCommonDir());
      // A daemon before topics noted the environment ready; a later one saw none.
      earlier(store, READY);
      earlier(store, NO_ENVIRONMENT, TOPIC);

      await start(fixture, store);
      expect(readDaemonNotes(store, "wt").findLast((n) => n.topic === TOPIC)?.text).toBe(READY);
      expect(environmentNotes(store)).not.toContain(NO_ENVIRONMENT);
    },
  );
});
