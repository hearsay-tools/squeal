import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type { CheckId, Consumer } from "../../src/core/types/index.js";
import { fixedStatus } from "../delivery/fakes.js";
import { result } from "../state/helpers.js";
import { fakeRepo, seedStore } from "../status/helpers.js";

function why(name: string, cwd: string): { code: number; json: { check?: CheckId } } {
  const out: string[] = [];
  const io = { stdout: (text: string) => out.push(text), stderr: () => {}, cwd };
  const code = main(["why", name, "--json"], io);
  const stdout = out.join("");
  return { code, json: JSON.parse(stdout) };
}

describe("a check name printed in a delta", () => {
  it("round-trips through squeal why: file-level, project, capped", async () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const checks: CheckId[] = [
      { kind: "file", project: "web", testPath: "src/new.test.ts" },
      { kind: "test", project: "", testPath: "src/a.test.ts", fullName: "math > adds" },
      { kind: "test", project: "", testPath: "src/a.test.ts", fullName: `long ${"n".repeat(400)}` },
    ];
    store.testFileKeys.upsertMany(
      checks.map((c) => ({
        worktreeId: repo.mainId,
        testFile: { project: c.project, path: c.testPath },
        key: "k1",
        revision: 1,
        pending: null,
      })),
    );
    const consumer: Consumer = { worktreeId: repo.mainId, sessionId: "s", agentId: "main" };
    const delivery = createDelivery(store, { status: fixedStatus() });
    await delivery.register(consumer);
    createStateSink(store).applyResults(
      repo.mainId,
      1,
      checks.map((c) => result(c, "fail", { worktreeId: repo.mainId })),
      { checkpointId: null },
    );
    const delta = await delivery.onToolBoundary(consumer);
    store.close();
    if (delta === null) throw new Error("expected a delta");

    const names = formatDelta(delta)
      .split("\n")
      .filter((line) => line.startsWith("FAIL  "))
      .map((line) => line.slice("FAIL  ".length));
    expect(names).toContain("[web] src/new.test.ts (file-level)");
    expect(names).toContain("src/a.test.ts > math > adds");
    expect(names.filter((name) => name.endsWith("..."))).toHaveLength(1);
    const answers = names.map((name) => why(name, repo.main));
    expect(answers.map((a) => a.code)).toEqual([0, 0, 0]);
    expect(answers.map((a) => a.json.check)).toEqual(expect.arrayContaining(checks));
  });
});
