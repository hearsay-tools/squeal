import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PYTHONS, requireSynced, type Synced, syncFixture } from "../helpers/pytest-env.js";
import { accepted, describePlayed, play } from "./driver.js";
import { pytestPack } from "./packs/pytest.js";
import { SCENARIOS } from "./scenarios/index.js";

/*
 * Spec 016 D1: every kit scenario through pytest's pack, on each Python CI
 * installs. The environment is synced as the pytest adapter tests sync
 * theirs, from the validity corpus's project, which installs pytest alone:
 * a declared environment outside the worktree may install nothing editable
 * from outside it, and the adapter tests' fixtures install theirs.
 */

const PYTEST_ONLY = resolve(import.meta.dirname, "../keys/validity/python");

describe.each(PYTHONS)("the kit on pytest under Python %s (spec 016 D1)", (version) => {
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  let scratch = "";
  beforeAll(() => {
    synced = syncFixture(PYTEST_ONLY, version);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-kit-pytest-")));
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  });

  it.for(SCENARIOS)("$name: $title", { timeout: 120_000 }, async (scenario, ctx) => {
    const { python, env } = requireSynced(ctx, synced);
    // The adapter keeps bytecode under its cache directory (row 007-29), as the daemon runs it.
    const { PYTHONDONTWRITEBYTECODE: _, ...source } = env;
    const played = await play(scenario, pytestPack(python, source), scratch);
    expect(accepted(played.verdict), describePlayed(played)).toBe(true);
  });
});
