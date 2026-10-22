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

/**
 * The check names a delta prints: a block's head, or, in a group of failures with one error and
 * location (row 011-109), its lines between its location and its command.
 */
function namesIn(text: string): string[] {
  return text.split("\n\n").flatMap((block) => {
    const [head = "", ...lines] = block.split("\n");
    if (!head.startsWith("FAIL  ")) return [];
    if (!/^FAIL {2}\d+ checks with one error and location /.test(head)) return [head.slice(6)];
    const from = lines.findIndex((l) => l.trimStart().startsWith("at ")) + 1;
    const to = lines.findIndex((l) => l.trimStart().startsWith("Full list: "));
    return lines.slice(from, to).map((l) => l.trim());
  });
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
      // The file-level check fails alone; the two tests share an error, so they print as a group.
      checks.map((c) =>
        result(c, "fail", {
          worktreeId: repo.mainId,
          ...(c.kind === "file" ? { message: "Cannot find module 'x'" } : {}),
        }),
      ),
      { checkpointId: null },
    );
    const delta = await delivery.onToolBoundary(consumer);
    store.close();
    if (delta === null) throw new Error("expected a delta");

    const text = formatDelta(delta);
    expect(text).toContain("FAIL  2 checks with one error and location (2 tests)\n");
    const names = namesIn(text);
    expect(names).toContain("[web] src/new.test.ts (file-level)");
    expect(names).toContain("src/a.test.ts > math > adds");
    expect(names.filter((name) => name.endsWith("..."))).toHaveLength(1);
    const answers = names.map((name) => why(name, repo.main));
    expect(answers.map((a) => a.code)).toEqual([0, 0, 0]);
    expect(answers.map((a) => a.json.check)).toEqual(expect.arrayContaining(checks));
  });
});
