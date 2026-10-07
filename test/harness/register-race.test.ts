import { describe, expect, it, vi } from "vitest";
import { readTurn } from "../../src/core/delivery/turn.js";
import type { HarnessDelivery } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { recorded, squealRepo } from "./helpers.js";

/*
 * Review wave 10, S1 and probe P2 (task 001-89): UserPromptSubmit registered,
 * then started the turn in a second transaction and dropped what that
 * returned. A result landing between the two was written into the view and
 * never told. Here a result lands right after the registration commits.
 */

const hooks = vi.hoisted(() => ({ afterRegister: null as (() => void) | null }));

vi.mock("../../src/core/delivery/index.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/delivery/index.js")>();
  return {
    ...real,
    createDelivery: (...args: Parameters<typeof real.createDelivery>): HarnessDelivery => {
      const delivery = real.createDelivery(...args);
      return {
        ...delivery,
        register: async (consumer, options) => {
          const registration = await delivery.register(consumer, options);
          hooks.afterRegister?.();
          return registration;
        },
      };
    },
  };
});

const INTERACTIVE = { CLAUDE_CODE_SESSION_ATTENDED: "1", CLAUDE_CODE_ENTRYPOINT: "cli" };
const deps: HookDeps = { env: INTERACTIVE, ensureDaemon: async () => "alive" };

describe("a result landing during UserPromptSubmit's registration (review wave 10, P2)", () => {
  it("is told at the next tool boundary, never written into the view untold", async () => {
    const r = squealRepo();
    r.apply(r.pass());
    hooks.afterRegister = () => {
      hooks.afterRegister = null;
      r.apply(r.fail());
    };

    const prompt = await runHook(
      "user-prompt-submit",
      recorded("user-prompt-submit", r.root),
      deps,
    );
    const batch = await runHook("post-tool-batch", recorded("post-tool-batch", r.root), deps);

    const told = `${prompt.stdout}\n${batch.stdout}`;
    expect(told).toContain("PASS -> FAIL");
    expect(readTurn(r.store, r.consumer()).turn).toBe("in-turn");
  });
});
