import { describe, expect, it } from "vitest";
import { owedRegistration } from "../../src/core/delivery/registration-owed.js";
import { storePaths } from "../../src/core/store/paths.js";
import { type HookContext, type HookLocation, locate } from "../../src/harness/shared/context.js";
import { type HookDeps, withContext } from "../../src/harness/shared/hook.js";
import { registerAndHandOver } from "../../src/harness/shared/owed.js";
import { PRIMER_OPENING } from "../../src/harness/shared/primer.js";
import { threadLockHolder } from "../helpers/busy-store.js";
import { SESSION, type SquealRepo, squealRepo } from "./helpers.js";

/*
 * Row 005-117: `registerAndHandOver` is the one sequence of every harness's registration
 * (rows 005-98, 005-102): register, then start the daemon, then hand the text over. The
 * per-entry wiring checks are `register-first-harnesses.test.ts`, `register-fails.test.ts` and
 * `registration-primer.test.ts`.
 */

type Step = "registered" | "ensure" | "sent";

/** A worktree with no daemon, and deps whose daemon start notes its step in `steps`. */
function setup(daemon: "none" | "alive" = "none") {
  const r = squealRepo();
  r.apply(r.pass());
  r.daemon(daemon);
  const steps: Step[] = [];
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    ensureDaemon: async () => {
      steps.push("ensure");
      return "spawned";
    },
  };
  return { r, steps, deps };
}

/** Runs `body` on `r`'s context, whose `registrationSent` notes its step in `steps`. */
function inContext<T>(
  r: SquealRepo,
  deps: HookDeps,
  steps: Step[],
  body: (context: HookContext, location: HookLocation) => Promise<T>,
): Promise<T | null> {
  const location = locate(r.root);
  if (location === null) throw new Error("no location");
  return withContext({ session_id: SESSION }, location, deps, (context) =>
    body(
      {
        ...context,
        delivery: {
          ...context.delivery,
          registrationSent: async (consumer) => {
            steps.push("sent");
            await context.delivery.registrationSent(consumer);
          },
        },
      },
      location,
    ),
  );
}

describe("registerAndHandOver (row 005-117)", () => {
  it("registers, then starts the daemon, then hands the text over", async () => {
    const { r, steps, deps } = setup();
    const text = await inContext(r, deps, steps, (context, location) =>
      registerAndHandOver(context, location, deps, {
        say: async () => {
          steps.push("registered");
          return { text: "said", owes: true };
        },
      }),
    );
    expect(text).toBe("said");
    expect(steps).toEqual(["registered", "ensure", "sent"]);
  });

  it("by default registers owing the harness's text, with the primer or without", async () => {
    for (const registrationPrimer of [true, false]) {
      const { r, steps, deps: base } = setup();
      const deps = { ...base, registrationPrimer };
      const text = await inContext(r, deps, steps, (context, location) =>
        registerAndHandOver(context, location, deps, { register: { atStart: true } }),
      );
      expect(text?.includes(PRIMER_OPENING)).toBe(registrationPrimer);
      expect(steps).toEqual(["ensure", "sent"]);
      expect(owedRegistration(r.store, r.consumer())).toBeNull();
    }
  });

  it("hands nothing over for a text that owes nothing, or for no registration", async () => {
    for (const said of [{ text: "primer", owes: false }, null]) {
      const { r, steps, deps } = setup();
      const text = await inContext(r, deps, steps, (context, location) =>
        registerAndHandOver(context, location, deps, { say: async () => said }),
      );
      expect(text).toBe(said?.text ?? null);
      expect(steps).toEqual(["ensure"]);
    }
  });

  it("with `whenDown`, starts no daemon while one is alive", async () => {
    const { r, steps, deps } = setup("alive");
    await inContext(r, deps, steps, (context, location) =>
      registerAndHandOver(context, location, deps, {
        whenDown: true,
        register: { inTurn: true },
      }),
    );
    expect(steps).toEqual(["sent"]);
  });

  it("starts the daemon when the registration throws, and throws its error (row 005-102)", async () => {
    const { r, steps, deps } = setup();
    threadLockHolder(storePaths(r.repo.commonDir).database, 10_000).take();
    const run = inContext(r, deps, steps, (context, location) =>
      registerAndHandOver(context, location, deps, { register: { atStart: true } }),
    );
    await expect(run).rejects.toThrow(/locked/);
    expect(steps).toEqual(["ensure"]);
  });
});
