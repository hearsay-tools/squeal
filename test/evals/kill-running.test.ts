import { describe, expect, it } from "vitest";
import { groupLive, killRunning, runBounded } from "../../evals/lib/index.mjs";
import { alive } from "./fake-cell.js";

// A runner's teardown returns only once the session's process group has no live process left:
// main's CI saw run-cell.test.ts's S2 test find a just-killed harness still there (006, 2026-10-11).
describe("killRunning", () => {
  it("waits until every process in the session's group is gone", async () => {
    let out = "";
    const session = runBounded({
      command: "sh",
      args: ["-c", "sleep 30 & echo $! $$; wait"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 60_000,
      onStdout: (d) => {
        out += d.toString();
      },
      log: () => {},
    });
    const deadline = Date.now() + 10_000;
    while (!/\d+ \d+/.test(out) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    const [child, shell] = out.trim().split(" ").map(Number) as [number, number];
    expect(alive(child) && alive(shell)).toBe(true);
    await killRunning("SIGKILL");
    expect(groupLive(shell)).toBe(false);
    expect(alive(child)).toBe(false);
    expect(alive(shell)).toBe(false);
    expect((await session).signal).toBe("SIGKILL");
  });

  it("returns at once when nothing is running", async () => {
    const start = Date.now();
    await killRunning("SIGKILL");
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
