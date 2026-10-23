import { describe, expect, it } from "vitest";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import { recordedText, recordRunLoad } from "../../src/core/retry/index.js";
import { formatStatus, formatWhy, readStatus, readWhy } from "../../src/core/status/index.js";
import { stepCommand, stepText } from "../../src/core/status/next-step-text.js";
import { fixedStatus, liveDaemon } from "../delivery/fakes.js";
import { reportOf } from "../status/why-seed.js";
import { AWKWARD_PATHS, loadRetryArgs, NOW, seededFailure } from "./load-retry-fixture.js";

/*
 * Review 0.1.271 S1 (row 011-67): the load retry command a known failure
 * names passes its path to a POSIX shell as one argument, so a path with a
 * space or a quote selects that file; a plain path prints bare, as before.
 */

const ARGS = (path: string) => ["retry", path, "--reason", "load"];

function underLoad(path: string) {
  const seeded = seededFailure("fail", path);
  recordRunLoad(seeded.store, "run-1", 2);
  return seeded;
}

describe("the load retry command's path is one shell argument (review 0.1.271 S1)", () => {
  it.each(AWKWARD_PATHS)("in status, %s", (path) => {
    const { repo } = underLoad(path);
    const status = readStatus(repo.main, { now: () => NOW });
    expect(loadRetryArgs(formatStatus(status, NOW))).toEqual(ARGS(path));
    // From `src/`, the path the command names is the file's from there.
    const fromSrc = formatStatus(status, NOW, "squeal", { base: "src" });
    expect(loadRetryArgs(fromSrc)).toEqual(ARGS(path.slice("src/".length)));
  });

  it.each(AWKWARD_PATHS)("in the registration report, %s", async (path) => {
    const { repo, store } = underLoad(path);
    liveDaemon(store, repo.mainId);
    const delivery = createDelivery(store, { status: fixedStatus() });
    const consumer = { worktreeId: repo.mainId, sessionId: "s1", agentId: "main" };
    const registration = await delivery.register(consumer, { atStart: true });
    const text = formatRegistration(registration, undefined, "squeal", NOW);
    expect(loadRetryArgs(text)).toEqual(ARGS(path));
  });

  it.each(AWKWARD_PATHS)("in why, %s", (path) => {
    const { repo, name } = underLoad(path);
    const text = formatWhy(reportOf(readWhy(repo.main, name)), "squeal", { now: NOW });
    expect(loadRetryArgs(text)).toEqual(ARGS(path));
  });

  it("prints a plain path bare, as before", () => {
    const facts = {
      worktreeId: "wt-a",
      worktreeRoot: null,
      revision: 4 as never,
      loadPerCpu: 2,
    };
    const text = recordedText(facts, "wt-a", NOW, { command: "squeal", path: "src/a-b_c.test.ts" });
    expect(text).toContain("`squeal retry src/a-b_c.test.ts --reason load`");
    expect(loadRetryArgs(text)).toEqual(ARGS("src/a-b_c.test.ts"));
  });

  it("names a path as a status retry step does (row 011-130)", () => {
    const path = "test/a b.test.ts";
    const facts = { worktreeId: "wt-a", worktreeRoot: null, revision: 4 as never, loadPerCpu: 2 };
    const clause = recordedText(facts, "wt-a", NOW, { command: "squeal", path });
    expect(stepCommand({ kind: "retry" }, [path], "squeal")).toBe(
      "squeal retry 'test/a b.test.ts'",
    );
    expect(stepText({ kind: "retry" }, [path], "squeal")).toBe(
      "`squeal retry 'test/a b.test.ts'` runs it once",
    );
    expect(clause).toContain("`squeal retry 'test/a b.test.ts' --reason load`");
    expect(loadRetryArgs(clause)).toEqual(ARGS(path));
  });
});
