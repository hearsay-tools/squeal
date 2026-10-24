import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { addWorktree, createRepo, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";

/*
 * Task 011-14, the inherited half of issue 28: worktree B's run of a file
 * heals worktree A (`storeResults` refreshes A from B's rows) while another
 * check of the file fails in both with a fresh port and temp directory. A
 * receives B's row for that check with no edit of its own; with the masked
 * fingerprint it is the same failure, so A is told `FAIL -> PASS` for the
 * healed check and nothing about the other.
 */

const FILE = "test/serve.test.ts";
const serve: CheckId = { kind: "test", project: "", testPath: FILE, fullName: "serve" };
const heals: CheckId = { kind: "test", project: "", testPath: FILE, fullName: "heals" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { recursive: true, force: true });
});

/** `serve` fails with a fresh port and temp path each run; `heals` fails while the marker exists. */
function serveRepo() {
  const repo = createRepo();
  const marker = join(tmpdir(), `squeal-011-14-${randomUUID()}`);
  markers.push(marker);
  writeFileSync(
    join(repo.main, FILE),
    [
      'import { existsSync, mkdtempSync, rmSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      'import { expect, it } from "vitest";',
      "",
      'it("serve", () => {',
      "  const port = 30000 + Math.floor(Math.random() * 30000);",
      '  const dir = mkdtempSync(join(tmpdir(), "cez-installed-workers-"));',
      "  rmSync(dir, { recursive: true });",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture's own template literal.
      "  throw new Error(`listen EADDRINUSE 127.0.0.1:${port}, port ${port} in use, open '${dir}/packages/cli.js'`);",
      "});",
      `it("heals", () => expect(existsSync(${JSON.stringify(marker)})).toBe(false));`,
      "",
    ].join("\n"),
  );
  git(repo.main, ["add", FILE]);
  git(repo.main, ["commit", "-qm", "serve"]);
  writeFileSync(marker, "");
  return { ...repo, marker };
}

describe(
  "a heal from another worktree with an equal masked fingerprint (task 011-14)",
  SLOW,
  () => {
    it("tells A FAIL -> PASS for the healed check and no changed failure", async () => {
      const repo = serveRepo();
      const other = addWorktree(repo.main, repo.dir, "other");
      const store = openRepoStore(repo.commonDir);
      const a = await openHarness(repo.main, store, repo.commonDir, {
        rerunCap: 0,
        policy: RUN_MISSING,
      });
      await a.scheduler.start();
      await a.scheduler.idle();
      expect(a.sink.stateOf(serve)).toMatchObject({ outcome: "fail", validity: "current" });
      expect(a.sink.stateOf(heals)).toMatchObject({ outcome: "fail", validity: "current" });
      const told = await a.consumer();
      const before = store.results.latestForCheck(serve);

      rmSync(repo.marker);
      const b = await openHarness(other, store, repo.commonDir, { rerunCap: 0 });
      await b.scheduler.start();
      await b.scheduler.idle();
      expect(b.keyOf(FILE)).toBe(a.keyOf(FILE));

      // B's run wrote the rows and healed A from them; `serve`'s raw text differs, its fingerprint not.
      const after = store.results.latestForCheck(serve);
      expect(after?.provenance.worktreeId).toBe(b.worktreeId);
      expect(after?.errors[0]?.message).not.toBe(before?.errors[0]?.message);
      expect(after?.fingerprint).toBe(before?.fingerprint);
      expect(after?.fingerprint).toContain(
        "127.0.0.1:<port>, port <port> in use, open '<tmp>/packages/cli.js'",
      );
      expect(store.knownStates.get(a.worktreeId, heals)).toMatchObject({ outcome: "pass" });
      expect(store.transitions.history(a.worktreeId, serve).map((t) => t.kind)).not.toContain(
        "fail-changed",
      );

      const delta = await told.delivery.onToolBoundary(told.consumer);
      expect(delta?.entries.map((e) => [e.check, e.kind])).toEqual([[heals, "fail-to-pass"]]);
    });
  },
);
