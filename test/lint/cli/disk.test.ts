import { chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detailsOnDisk } from "../../../src/cli/lint-disk.js";
import { formatLintDetails } from "../../../src/cli/lint-report.js";
import { worktreeIdFor } from "../../../src/core/fs/index.js";
import { lintDetails } from "../../../src/core/lint/surface/report.js";
import { lintStoreSource } from "../../../src/core/lint/surface/source.js";
import { deliveryOf, runLint, wiredRig } from "../wiring/rig.js";

/*
 * Wave 2 rules 1 and 2 for `squeal lint`: a result is shown as current only
 * while its file's bytes on disk are the bytes it was linted at. An edit
 * the daemon has not recorded, even one between the store read and the
 * disk read, makes the file pending; the revision and findings it had stay,
 * as provenance, in the text and the JSON.
 */

const FILES = {
  "src/a.js": "bad no-undef\nbad no-console\n",
  "src/b.js": "ok\n",
  "lib/c.js": "bad eqeqeq\n",
};

const PENDING_A =
  "  src/a.js: pending: changed on disk since its lint at revision 1 (2 findings then)";

describe("squeal lint against the bytes on disk (wave 2 rule 1)", () => {
  it("reads an edit between the store read and the disk read as pending, keeping what it had", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    const source = lintStoreSource(rig.repo.commonDir, rig.repo.main);
    const read = lintDetails(source, worktreeIdFor(rig.repo.main), ["src/a.js"]);
    // The attack: the agent saves between `squeal lint`'s two reads.
    rig.write("src/a.js", "ok\n");
    const details = await detailsOnDisk(rig.repo.main, read ?? expect.unreachable());
    const [a] = details.files;
    expect(a).toMatchObject({
      path: "src/a.js",
      outcome: "pending",
      reason: "changed on disk since its lint",
      revision: 1,
      blob: read?.files[0]?.blob,
    });
    expect(a?.findings).toHaveLength(2);
    const text = formatLintDetails(details, ["src/a.js"]);
    expect(text).toContain(PENDING_A);
    expect(text).not.toMatch(/src\/a\.js: 2 findings|no-undef found/);
  });

  it("lists no unrecorded edit as current, in the text and the JSON, with no daemon", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    rig.write("src/a.js", "ok\n");
    const { code, out } = await runLint(rig.repo.main, []);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "Lint: 1 file with findings",
        "  lib/c.js: 1 finding, linted at revision 1",
        "    1:1  error    eqeqeq  eqeqeq found",
        "Not judged:",
        PENDING_A,
        "Not current in this worktree: 1 pending.",
        "",
      ].join("\n"),
    );
    const json = JSON.parse((await runLint(rig.repo.main, ["--json"])).out);
    expect(json).toMatchObject({ pending: 1, unknown: 0 });
    expect(json.files).toContainEqual(
      expect.objectContaining({ path: "src/a.js", outcome: "pending", revision: 1 }),
    );
  });

  it("reads a deleted file as pending, and the same bytes again as current", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    rmSync(join(rig.repo.main, "src/b.js"));
    rig.write("src/a.js", FILES["src/a.js"]);
    const { out } = await runLint(rig.repo.main, ["src/a.js", "src/b.js"]);
    expect(out.split("\n")).toEqual(
      expect.arrayContaining([
        "  src/a.js: 2 findings, linted at revision 1",
        "  src/b.js: pending: no longer a file on disk since its lint at revision 1 (no findings then)",
      ]),
    );
  });

  it.skipIf(process.getuid?.() === 0)(
    "reads a file Squeal cannot read as unknown, with why",
    async () => {
      const rig = await wiredRig(FILES, { alive: false });
      const path = join(rig.repo.main, "src/a.js");
      chmodSync(path, 0o000);
      try {
        const { out } = await runLint(rig.repo.main, ["src/a.js", "--json"]);
        expect(JSON.parse(out)).toMatchObject({
          unknown: 1,
          files: [
            { path: "src/a.js", outcome: "unknown", reason: "Squeal could not read it: EACCES" },
          ],
        });
        expect((await runLint(rig.repo.main, ["src/a.js"])).out).toContain(
          "  src/a.js: unknown: Squeal could not read it: EACCES",
        );
      } finally {
        chmodSync(path, 0o644);
      }
    },
  );

  it("with --changed, says a file edited since its last lint is pending now", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/b.js": "bad no-undef\n" });
    rig.write("src/b.js", "ok\n");
    const session = { CLAUDE_CODE_SESSION_ID: "s1" };
    expect((await runLint(rig.repo.main, ["--changed"], session)).out).toContain(
      "  FAIL lint: src/b.js: 1 finding, +1 no-undef (no-undef found); at revision 2; now pending: changed on disk since its lint\n",
    );
    const json = JSON.parse((await runLint(rig.repo.main, ["--changed", "--json"], session)).out);
    expect(json.entries).toEqual([
      expect.objectContaining({ path: "src/b.js", outcome: "pending", revision: 2, findings: 1 }),
    ]);
  });
});

describe("squeal lint with a folder (017 D8)", () => {
  it("shows the files a folder holds, at a / boundary, from any directory", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    const { out } = await runLint(join(rig.repo.main, "src"), [".", "../li"]);
    expect(out).toBe(
      [
        "Lint: 1 file with findings in src, li",
        "  src/a.js: 2 findings, linted at revision 1",
        "    1:1  error    no-undef  no-undef found",
        "    2:1  error    no-console  no-console found",
        "  src/b.js: no findings, linted at revision 1",
        "Not linted (ESLint's config or the lint policy leaves them out):",
        "  li",
        "",
      ].join("\n"),
    );
  });
});
