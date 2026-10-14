import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import { outsideGit } from "../harness/bundle-helpers.js";
import { type SquealRepo, squealRepo } from "../harness/helpers.js";
import { buildPiBundles } from "../harness/pi/helpers.js";
import { piWorld, runWithExtension, squealMessages } from "../harness/pi/real-pi.js";
import { type PiMode, type PiRun, piUnavailable, textOf } from "../helpers/pi.js";

/*
 * Spec 009 goals 5 and 6 against the real Pi 1.0.4 and the shipped bundle:
 * the primer in every request, compaction included; a dead daemon, a
 * missing store and a repository without Squeal never crash Pi, and `pi -p`
 * exits promptly after its run.
 */

const unavailable = piUnavailable();
if (unavailable && process.env.CI) throw new Error(`Pi unavailable on CI: ${unavailable}`);

let extension = "";
let cleanup = () => {};
beforeAll(async () => {
  const built = await buildPiBundles();
  extension = join(built.dir, "extension.mjs");
  cleanup = built.cleanup;
}, 60_000);
afterAll(() => cleanup());

const runs: PiRun[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});

/** Pi's start, the fake model and the handlers, with room for a loaded host. */
const PROMPT_EXIT_MS = 8_000;
const SECTION = `<squeal>\n${PRIMER_OPENING}`;
const PLAN = [{ tools: [{ name: "write", arguments: { path: "out.txt", content: "x\n" } }] }];

async function timed(run: () => Promise<PiRun>): Promise<[PiRun, number]> {
  const started = performance.now();
  const result = await run();
  runs.push(result);
  return [result, performance.now() - started];
}

/** A fixture repository whose store is gone; with `config`, it still has a `squeal.config.json`. */
function withoutStore(config: boolean): SquealRepo {
  const r = squealRepo();
  r.store.close();
  rmSync(join(r.repo.commonDir, "squeal"), { recursive: true });
  if (config) writeFileSync(join(r.root, "squeal.config.json"), "{}\n");
  return r;
}

describe.skipIf(unavailable !== undefined)("Squeal's silence and the primer with real Pi", () => {
  it("rpc: the primer is in every request of the session, after compact too", {
    timeout: 60_000,
  }, async () => {
    const r = squealRepo();
    r.apply(r.pass());
    const world = await piWorld(r);
    const [run] = await timed(() =>
      runWithExtension(extension, {
        mode: "rpc",
        cwd: r.root,
        // Pi keeps the last 20,000 tokens (about 80,000 characters): a larger second prompt
        // keeps itself, and the first run is summarized.
        prompts: ["one", `two ${"x".repeat(100_000)}`, { type: "compact" }, "three"],
        env: world.env,
        plan: [{ text: "a" }, { text: "b" }, { text: "summary" }, { text: "c" }],
      }),
    );

    expect(run.exitCode, run.stderr).toBe(0);
    expect(
      run.events.some(
        (e) => e.type === "response" && e.command === "compact" && e.success === true,
      ),
    ).toBe(true);
    const [one, two, summary, three] = run.requests;
    expect(summary).toBeDefined();
    // The run after compaction sees a summary, not the first prompt.
    expect(two?.messages.some((m) => textOf(m) === "one")).toBe(true);
    expect(three?.messages.some((m) => textOf(m) === "one")).toBe(false);
    for (const request of [one, two, three]) expect(request?.systemPrompt).toContain(SECTION);
    // The section is set the same each run, so Pi sends no delta for it.
    expect(three?.systemPrompt).toBe(one?.systemPrompt);
  });

  it.each<PiMode>(["print", "json", "rpc"])(
    "%s: a dead daemon crashes nothing, and Pi exits promptly",
    { timeout: 60_000 },
    async (mode) => {
      const r = squealRepo();
      r.apply(r.pass());
      r.daemon("stale");
      const world = await piWorld(r, "dead");
      const [run, ms] = await timed(() =>
        runWithExtension(extension, {
          mode,
          cwd: r.root,
          prompts: ["work"],
          env: world.env,
          plan: [...PLAN, { text: "done" }],
        }),
      );

      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.stderr).not.toMatch(/Extension error/);
      expect(run.events.some((e) => e.type === "extension_error")).toBe(false);
      expect(run.requests).toHaveLength(2);
      // The CLI stood in for a daemon that never answers; ensure gave up within its budget.
      expect(world.spawnedDaemon()).toBe(true);
      expect(ms).toBeLessThan(PROMPT_EXIT_MS);
    },
  );

  it.each<[string, () => string]>([
    // Under /tmp: the suite's own temp dir may sit inside a checkout.
    ["outside any repository", () => outsideGit()],
    ["in a repository without Squeal", () => withoutStore(false).root],
    ["with a config and no store", () => withoutStore(true).root],
  ])("print: silent %s, and Pi exits promptly", { timeout: 60_000 }, async (_, project) => {
    const cwd = project();
    const world = await piWorld(null, "dead");
    const [run, ms] = await timed(() =>
      runWithExtension(extension, {
        mode: "print",
        cwd,
        prompts: ["work"],
        env: world.env,
        plan: [...PLAN, { text: "done" }],
      }),
    );

    expect(run.exitCode, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout.trim()).toBe("done");
    expect(run.requests).toHaveLength(2);
    for (const request of run.requests) {
      expect(squealMessages(request)).toEqual([]);
      expect(request.systemPrompt).not.toContain("<squeal>");
    }
    expect(ms).toBeLessThan(PROMPT_EXIT_MS);
  });
});
