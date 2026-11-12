import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { importCommand } from "../../src/cli/import.js";
import type { CliIo } from "../../src/cli/main.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { DeskEvents } from "../../src/core/daemon/desk.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import { listImports } from "../../src/core/store/imports.js";
import { encodeBundle } from "../../src/core/store/transfer-bundle.js";
import type { ImportRequest } from "../../src/core/types/daemon-writes.js";
import type { CheckKey } from "../../src/core/types/keys.js";
import { createFixtureRepo, SLOW, withStore } from "./helpers.js";

/*
 * Spec 021 D15 (row 021-20): a running daemon takes `squeal import`'s
 * request on its desk and imports the file itself (`daemon.ts` hands the
 * request to `importInDaemon`), and the command prints what it added,
 * re-keying at a commit this repository holds.
 */

const desk = vi.hoisted(() => ({ imports: [] as unknown[] }));

vi.mock("../../src/core/daemon/desk.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/daemon/desk.js")>();
  return {
    ...actual,
    prepareFrontDesk: (...args: Parameters<typeof actual.prepareFrontDesk>) => {
      const prepared = actual.prepareFrontDesk(...args);
      return {
        ...prepared,
        open: (identity, events) => {
          const requestImport = events.requestImport;
          const recorded: DeskEvents = {
            ...events,
            ...(requestImport === undefined
              ? {}
              : {
                  requestImport: (request: ImportRequest) => {
                    desk.imports.push(request);
                    return requestImport(request);
                  },
                }),
          };
          return prepared.open(identity, recorded);
        },
      } satisfies typeof prepared;
    },
  };
});

describe("squeal import beside a running daemon (021 D15, row 021-20)", SLOW, () => {
  it("is imported by the daemon, which re-keys at the commit it holds", async () => {
    const repo = createFixtureRepo();
    onTestFinished(repo.cleanup);
    const daemon = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in daemon) throw new Error(daemon.message);
    onTestFinished(async () => {
      await daemon.stop("stop-requested");
    });
    await daemon.ready;

    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo.root }).toString().trim();
    const path = "test/imported.test.ts";
    const key = "key-imported" as CheckKey;
    const dir = mkdtempSync(join(tmpdir(), "sq-imp-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "results.json.gz");
    writeFileSync(
      file,
      encodeBundle({
        format: "squeal-results/1",
        header: {
          squealVersion: "0.0.0-test",
          keyFormat: KEY_FORMAT_VERSION,
          commit,
          dirty: false,
          createdAt: 1,
          source: { kind: "local" },
        },
        environments: [],
        testFiles: [{ project: "", path, key, closure: null, observed: {} }],
        observedStartup: [],
        results: [
          {
            project: "",
            testPath: path,
            kind: "file",
            fullName: null,
            location: null,
            key,
            outcome: "pass",
            durationMs: 1,
          },
        ],
      }),
    );
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      cwd: repo.root,
      env: repo.env,
    };
    expect(await importCommand([file], io)).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^Imported 1 results of 1 test file from /);
    // The commit is here, so no "fetch it and import again" line.
    expect(stdout).not.toContain("does not hold commit");
    expect(desk.imports).toMatchObject([{ type: "import", file, dryRun: false }]);
    expect(withStore(repo, (store) => listImports(store).map((i) => i.header.commit))).toEqual([
      commit,
    ]);
  });
});
