import { describe, expect, it } from "vitest";
import { narrowed } from "../../evals/lib/index.mjs";

// 006-45: run-baseline's --models and --tasks run part of the suite.
const config = {
  tasks: ["a1-break", "a2-slow", "a3-harmless"],
  models: [
    { harness: "claude", model: "claude-haiku-5-5" },
    { harness: "codex", model: "gpt-6-luna" },
  ],
  repetitions: 10,
};

describe("narrowed", () => {
  it("keeps everything when nothing is named", () => {
    expect(narrowed(config)).toEqual(config);
  });

  it("keeps only the named models and tasks, in the config's order", () => {
    const n = narrowed(config, { models: ["claude-haiku-5-5"], tasks: ["a2-slow", "a1-break"] });
    expect(n.models).toEqual([{ harness: "claude", model: "claude-haiku-5-5" }]);
    expect(n.tasks).toEqual(["a1-break", "a2-slow"]);
    expect(n.repetitions).toBe(10);
  });

  it("refuses a name the config does not hold", () => {
    expect(() => narrowed(config, { models: ["claude-haku-5-5"] })).toThrow(
      "--models: not in the config: claude-haku-5-5",
    );
    expect(() => narrowed(config, { tasks: ["a9"] })).toThrow("--tasks: not in the config: a9");
  });
});
