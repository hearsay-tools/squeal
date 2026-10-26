import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { namedWaitCommand } from "../../src/cli/named-print.js";
import { focusTexts, takeChecks } from "../../src/cli/status-wait-focus.js";
import { focusNamed } from "../../src/cli/status-wait-promote.js";
import { A, ref, repoWith, SLOW_FILE } from "./status-wait-fixture.js";
import { capture, focusing } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23): how `status` reads
 * `--check`, the printed prefix a text may carry, the `focus` request on
 * the daemon's socket, and the files the daemon runs whole.
 */

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("status --check (011 C15, row 011-146)", () => {
  it("takes each --check text out of the arguments, in both forms", () => {
    expect(takeChecks(["a.test.ts", "--check", "x y", "--check=z", "--json"])).toEqual({
      checks: ["x y", "z"],
      rest: ["a.test.ts", "--json"],
    });
    expect(takeChecks(["a.test.ts", "--check"])).toBe("--check takes a part of a check name");
    expect(takeChecks(["--check="])).toBe("--check takes a part of a check name");
  });

  it("with no path, or no text, it is a usage error", async () => {
    const { repo } = repoWith([A]);
    for (const args of [
      ["status", "--check", "x"],
      ["status", "--wait", "100", "--check", "x"],
      ["status", "--wait", "100", A, "--check"],
    ]) {
      const io = capture(repo.main);
      expect(await main(args, io), args.join(" ")).toBe(2);
      expect(io.err.join("")).toMatch(/^squeal status: --check (selects|takes)/);
    }
  });

  it("reads a text that begins with a named file's printed prefix without it", () => {
    const files = [ref(A), { project: "web", path: "web/b.test.ts" as never }];
    expect(
      focusTexts(
        [`${A} > claude U2`, "[web] web/b.test.ts > suite > case", "claude U2", `${A} > `],
        files,
      ),
    ).toEqual(["claude U2", "suite > case", `${A} > `]);
  });
});

describe("the focus request (011 C15, row 011-146)", () => {
  function socketPath(): string {
    const dir = mkdtempSync("/tmp/sq-focus-cli-");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return join(dir, "d.sock");
  }

  /** A worktree whose recorded daemon listens at a socket answering `focus` with `answer`. */
  async function answering(answer: unknown) {
    const path = socketPath();
    const requests: unknown[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.once("data", (line: string) => {
        const request = JSON.parse(line) as { type: string };
        if (request.type !== "ping") requests.push(request);
        const ping = { schemaVersion: 1, ok: true, type: "ping", phase: "ready" };
        socket.end(`${JSON.stringify(request.type === "ping" ? ping : answer)}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const { repo, store } = repoWith([A]);
    const row = store.worktrees.get(repo.mainId);
    if (row?.daemon == null) throw new Error("no daemon row");
    const now = Date.now();
    store.worktrees.upsert({
      ...row,
      daemon: { ...row.daemon, socketPath: path, startedAt: now - 1_000, heartbeatAt: now },
    });
    return { root: repo.main as never, requests };
  }

  it("sends the files, the texts and the time left, and reads the daemon's acceptance", async () => {
    const { root, requests } = await answering({ schemaVersion: 1, ok: true, type: "focus" });

    expect(await focusNamed(root, [ref(A)], ["claude U2"], 1_234.6)).toBe("accepted");
    expect(requests).toEqual([
      { type: "focus", testFiles: [ref(A)], texts: ["claude U2"], withinMs: 1_235 },
    ]);
  });

  it("an older daemon's unknown request is a refusal; no file or text sends nothing", async () => {
    const error = { schemaVersion: 1, ok: false, error: 'unknown request type "focus"' };
    const { root, requests } = await answering(error);

    expect(await focusNamed(root, [], ["x"], 1_000)).toBe("none");
    expect(await focusNamed(root, [ref(A)], [], 1_000)).toBe("none");
    expect(requests).toEqual([]);
    expect(await focusNamed(root, [ref(A)], ["x"], 1_000)).toBe("refused");
  });
});

describe("a file the daemon runs whole (011 C15, row 011-146)", () => {
  it("a slow file gets no focus: its reason, and the wait reads as a named wait", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    writeFileSync(
      join(repo.main, "squeal.config.json"),
      JSON.stringify({ slow: { include: [SLOW_FILE], trigger: "continuous" } }),
    );
    const daemon = focusing(store, repo.mainId, null, "accepted", 200);
    const io = capture(repo.main);

    const code = await namedWaitCommand(
      [SLOW_FILE],
      { json: false, checks: ["x"] },
      io,
      daemon.options,
    );

    expect(code).toBe(3);
    expect(daemon.sent).toEqual([]);
    expect(daemon.promoted).toEqual([[ref(SLOW_FILE)]]);
    expect(io.out.join("")).toContain(
      `Focused: ${SLOW_FILE}: slow file: focused checks run for fast files only; waiting for the file's run`,
    );
    expect(io.out.join("")).toMatch(/Named test files have no verdict: the deadline passed/);
  });
});
