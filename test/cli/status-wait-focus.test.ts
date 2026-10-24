import { describe, expect, it } from "vitest";
import { namedWaitCommand } from "../../src/cli/status-wait-paths.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { focusedRun, test, writeRuns } from "../status/focused-fixture.js";
import { result } from "../store/helpers.js";
import { A, B, finish, later, NOW, ref, repoWith } from "./status-wait-fixture.js";
import { A_DONE, A_QUEUED, capture, focusing } from "./status-wait-focus-fixture.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23, "Focused checks"): a named
 * wait with `--check` sends `focus` once beside the promotion and returns
 * at the focused outcome: exit 1 when a selected check failed, else 3, and
 * never the file's verdict. A file current before any focused run gives the
 * named wait's verdict; an older daemon leaves a named wait.
 */

const TEXT = "claude U";

describe("a named wait with --check (011 C15, row 011-146)", () => {
  it("a focused fail returns at its outcome with exit 1 and the drafted text", async () => {
    const { repo, store } = repoWith([A, B]);
    const fails = ["claude U2 ci and timer open", "claude U3 a human message"];
    const daemon = focusing(store, repo.mainId, { fails });
    const io = capture(repo.main);

    // B is pending too, but not named: the wait holds for A alone.
    const code = await namedWaitCommand([A], { json: false, checks: [TEXT] }, io, daemon.options);

    expect(code).toBe(1);
    // Sent once, beside the promotion, for the file named by its own path, with what is left.
    expect(daemon.promoted).toEqual([[ref(A)]]);
    expect(daemon.sent.map((s) => [s.files, s.texts])).toEqual([[[ref(A)], [TEXT]]]);
    expect(daemon.sent[0]?.withinMs).toBeGreaterThan(2_000);
    const lines = io.out.join("").trimEnd().split("\n");
    expect(lines).toContain(
      `Focused: 2 checks of ${A} at revision 4, run alone in 7.8 s; not the file's verdict.`,
    );
    expect(lines).toContain("  FAIL  claude U2 ci and timer open");
    expect(lines).toContain("        AssertionError: expected 'a' to contain 'b'");
    expect(lines).toContain(`        at ${A}:30:22`);
    expect(lines).toContain(
      "  A first run each, not re-run; the file's own run (78 checks) decides.",
    );
    // The file stays pending: the named wait's class lines, then the focused verdict last.
    expect(lines).toContain("Pending (1):");
    expect(lines.at(-1)).toMatch(
      new RegExp(
        `^Focused: 2 of 2 selected checks failed; no verdict for the file yet: \`squeal status --wait 600000 ${A}\` waits for it\\. Worktree: known failures 0`,
      ),
    );
  });

  it("a focused pass exits 3, not a verdict", async () => {
    const { repo, store } = repoWith([A]);
    const daemon = focusing(store, repo.mainId, { fails: [], passes: ["claude U1"] });
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: [TEXT] }, io, daemon.options);

    expect(code).toBe(3);
    const text = io.out.join("");
    expect(text).toContain("  pass  claude U1");
    expect(text).toContain(
      `Focused: 0 of 1 selected check failed; no verdict for the file yet: \`squeal status --wait 600000 ${A}\` waits for it`,
    );
  });

  it("a text that matches nothing returns at once with its line, exit 3", async () => {
    const { repo, store } = repoWith([A]);
    const daemon = focusing(store, repo.mainId, { fails: [], matched: 0, texts: ["nope"] });
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: ["nope"] }, io, daemon.options);

    expect(code).toBe(3);
    expect(io.out.join("")).toContain(
      `No check of ${A} holds "nope" at revision 4 (the run collected 78 checks).`,
    );
  });

  it("a file current before any focused run gives the named verdict, naming the selected checks", async () => {
    const { repo, store } = repoWith([], [A]);
    store.results.putMany([
      result(test(A, "claude U2 ci"), A_DONE, { outcome: "fail" }),
      result(test(A, "codex U1"), A_DONE),
    ]);
    const daemon = focusing(store, repo.mainId, null);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: [TEXT] }, io, daemon.options);

    // The named wait's verdict: its known states pass, so 0 as today; nothing was sent.
    expect(code).toBe(0);
    expect(daemon.sent).toEqual([]);
    const text = io.out.join("");
    expect(text).toContain(
      `Focused: 1 check of ${A} from the result its own run stored at revision 4, at its current key.`,
    );
    expect(text).toContain("  FAIL  claude U2 ci");
    expect(text).not.toContain("codex U1");
    expect(text).toMatch(/Named test files at revision 4: /);
  });

  it("a result its own run stored at the key answers before a focused run, exit 1 on its fail", async () => {
    const { repo, store } = repoWith([A]);
    // The file's first fail awaits C5's re-run: pending, with a result at its key.
    store.results.putMany([result(test(A, "claude U2 ci"), A_QUEUED, { outcome: "fail" })]);
    const daemon = focusing(store, repo.mainId, null);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: true, checks: [TEXT] }, io, daemon.options);

    expect(code).toBe(1);
    const payload = JSON.parse(io.out.join("")).selection;
    expect(payload.outcome).toBe("focused");
    expect(payload.focused.testFiles[0]).toMatchObject({
      path: A,
      source: "stored",
      matched: 1,
      collected: 1,
      checks: [{ name: `${A} > claude U2 ci`, outcome: "fail" }],
    });
  });

  it("an older daemon answers the request unknown: the fallback line first, then a named wait", async () => {
    const { repo, store } = repoWith([A]);
    const daemon = focusing(store, repo.mainId, null, "refused");
    later(200, () => finish(store, repo.mainId, A));
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: [TEXT] }, io, daemon.options);

    expect(code).toBe(0);
    const lines = io.out.join("").split("\n");
    expect(lines[0]).toBe(
      "Focused: this daemon (Squeal 0.0.0-test) runs whole files only; waiting for the file's run",
    );
    expect(lines.some((l) => l.startsWith("Focused: 0 of"))).toBe(false);
    expect(lines.find((l) => l.startsWith("Named test files"))).toMatch(
      /at revision 4: no known failures/,
    );
  });

  it("a discarded focused run does not end the wait: it waits for the run at the new key", async () => {
    const { repo, store } = repoWith([A]);
    const daemon = focusing(
      store,
      repo.mainId,
      { end: "discarded", reason: "src/a.ts changed" },
      "accepted",
      300,
    );
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: [TEXT] }, io, daemon.options);

    expect(code).toBe(3);
    expect(io.out.join("")).toContain(`Focused: ${A}: no focused outcome yet`);
    expect(io.out.join("")).toMatch(/Named test files have no verdict: the deadline passed/);
  });

  it("--json: selection.outcome focused and each selected check, additive", async () => {
    const { repo, store } = repoWith([A]);
    const daemon = focusing(store, repo.mainId, {});
    const io = capture(repo.main);

    await namedWaitCommand([A], { json: true, checks: [TEXT] }, io, daemon.options);

    const json = JSON.parse(io.out.join(""));
    expect(json.wait.outcome).toBe("focused");
    expect(json.selection.code).toBe(1);
    expect(json.selection.focused).toMatchObject({
      texts: [TEXT],
      testFiles: [
        {
          path: A,
          source: "focused",
          key: A_QUEUED,
          revision: 4,
          runId: "run-focused",
          durationMs: 7_800,
          end: "completed",
          matched: 1,
          collected: 78,
          checks: [
            { name: `${A} > claude U2 ci and timer open`, outcome: "fail", durationMs: 1_200 },
          ],
        },
      ],
    });
    // Never a result: the file is still pending, and no known failure came from it.
    expect(json.knownFailures).toEqual([]);
    expect(json.selection.testFiles[0].state).toBe("pending");
    expect(io.err.join("")).toContain("Focused: 1 of 1 selected check failed");
  });

  it("an earlier focused run at the key for other texts does not answer this wait", async () => {
    const { repo, store } = repoWith([A]);
    writeRuns(store, repo.mainId, [focusedRun(A, { key: A_QUEUED, texts: ["codex"] })]);
    const daemon = focusing(store, repo.mainId, null, "accepted", 200);
    const io = capture(repo.main);

    const code = await namedWaitCommand([A], { json: false, checks: [TEXT] }, io, daemon.options);

    expect(code).toBe(3);
    expect(daemon.sent).toHaveLength(1);
    expect(io.out.join("")).toContain(`Focused: ${A}: no focused outcome yet`);
  });
});

describe("--check selects inside a test file named by its own path (011 C15)", () => {
  it("with source paths only it is a usage error, exit 2, and nothing is sent", async () => {
    const { repo, store } = repoWith([A]);
    store.testFiles.put({
      testFile: ref(A),
      closure: {
        testFile: ref(A),
        paths: [A, "src/shared.ts"].sort() as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: repo.mainId,
    });
    const daemon = focusing(store, repo.mainId, null);
    const io = capture(repo.main);

    const code = await namedWaitCommand(
      ["src/shared.ts"],
      { json: false, checks: [TEXT] },
      io,
      daemon.options,
    );

    expect(code).toBe(2);
    expect(io.err.join("")).toBe(
      "squeal status: --check selects checks inside a test file named by its own path\n",
    );
    expect(daemon.sent).toEqual([]);
    expect(io.out).toEqual([]);
  });

  it("a text with the file's printed prefix is sent, and selects, as without it", async () => {
    const { repo, store } = repoWith([A]);
    const daemon = focusing(store, repo.mainId, {});
    const io = capture(repo.main);

    const code = await namedWaitCommand(
      [A],
      { json: false, checks: [`${A} > ${TEXT}`] },
      io,
      daemon.options,
    );

    expect(code).toBe(1);
    expect(daemon.sent[0]?.texts).toEqual([TEXT]);
  });
});
