import { describe, expect, it } from "vitest";
import { owedRegistration } from "../../src/core/delivery/registration-owed.js";
import { runHook } from "../../src/harness/claude-code/hooks.js";
import { HandOff } from "../../src/harness/shared/hand-off.js";
import type { HookDeps } from "../../src/harness/shared/hook.js";
import { PRIMER } from "../../src/harness/shared/primer.js";
import { recorded, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-98, the coordinator's decision C (2026-11-17): a session reads its registration
 * text once; a new session reads it with the primer, a resumed one without. The hook that
 * registers hands the text over last, in a write held until its output is written (row
 * 011-288's hand-off): `abandon` stands for a hook killed before its output, `commit` for one
 * whose output was written.
 */

const deps = (handOff?: HandOff): HookDeps => ({
  env: {},
  ensureDaemon: async () => "alive",
  ...(handOff === undefined ? {} : { handOff }),
});

const context = (stdout: string): string =>
  (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;

/** A SessionStart with `source` whose output is written (`written`) or lost to a kill. */
async function started(source: string, written: boolean): Promise<SquealRepo> {
  const r = squealRepo();
  r.apply(r.pass());
  r.daemon("alive");
  const handOff = new HandOff();
  const out = await runHook(
    "session-start",
    recorded("session-start", r.root, { source }),
    deps(handOff),
  );
  expect(out.stdout).not.toBe("");
  if (written) handOff.commit();
  else handOff.abandon();
  return r;
}

const batch = (r: SquealRepo) =>
  runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps());
const prompt = (r: SquealRepo) =>
  runHook("user-prompt-submit", recorded("user-prompt-submit", r.root), deps());

describe("a registration text a killed SessionStart did not hand over (row 005-98 C)", () => {
  it("comes at the next boundary with the primer after a startup, once", async () => {
    const r = await started("startup", false);
    expect(owedRegistration(r.store, r.consumer())).toEqual({ primer: true });

    const text = context((await batch(r)).stdout);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
    expect(owedRegistration(r.store, r.consumer())).toBeNull();
    expect((await batch(r)).stdout).toBe("");
  });

  it("comes at the next boundary with no primer after a resume, once", async () => {
    const r = await started("resume", false);
    expect(owedRegistration(r.store, r.consumer())).toEqual({ primer: false });

    const text = context((await batch(r)).stdout);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text).not.toContain(PRIMER);
    expect((await batch(r)).stdout).toBe("");
  });

  it("comes on the next prompt when that is first", async () => {
    const r = await started("startup", false);
    const text = context((await prompt(r)).stdout);
    expect(text).toMatch(/^SQUEAL · registered at revision 1\n/);
    expect(text.endsWith(`\n\n${PRIMER}`)).toBe(true);
    expect((await batch(r)).stdout).toBe("");
  });

  it("is not said again when the hook's output was written", async () => {
    for (const source of ["startup", "resume"]) {
      const r = await started(source, true);
      expect(owedRegistration(r.store, r.consumer())).toBeNull();
      expect((await batch(r)).stdout).toBe("");
      r.apply(r.fail());
      const text = context((await batch(r)).stdout);
      expect(text).not.toMatch(/registered at revision/);
      expect(text).not.toContain(PRIMER);
    }
  });

  it("is said again by a boundary whose own output was lost", async () => {
    const r = await started("startup", false);
    const lost = new HandOff();
    const first = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps(lost));
    expect(context(first.stdout)).toContain(PRIMER);
    lost.abandon();
    expect(context((await batch(r)).stdout)).toContain(PRIMER);
    expect((await batch(r)).stdout).toBe("");
  });

  it("ends with the consumer: a later registration owes only its own text", async () => {
    const r = await started("startup", false);
    await runHook("session-end", recorded("session-end", r.root), deps());
    expect(owedRegistration(r.store, r.consumer())).toBeNull();
    // A boundary registers it again, with the primer, and hands it over.
    expect(context((await batch(r)).stdout)).toContain(PRIMER);
    expect((await batch(r)).stdout).toBe("");
  });
});
