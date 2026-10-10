import { describe, expect, it } from "vitest";
import { codexCommand } from "../../src/harness/codex/command.js";
import { CONTEXT_CAP_CHARS, capContext } from "../../src/harness/codex/output.js";
import type { Coverage } from "../../src/harness/shared/coverage.js";
import { PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { HARNESSES, NOT_COVERED, primerOf, repoFor, sessionStart } from "./primer-helpers.js";

/*
 * Review wave 13aa, B2: a key row does not say which runner listed it, and
 * rows of a daemon's previous listing stay until the new one commits. So the
 * primer never names a runner's project from the rows, and counts slow files
 * as of the daemon's last listing. B3: however long the Codex CLI's path, the
 * primer keeps its coverage and its closing sentence within its cap.
 */

const SCRIPTS = { name: "scripts", argv: [], env: {}, include: ["scripts/*.test.mjs"] };

describe("rows the daemon listed before (review wave 13aa, B2)", () => {
  it.each(HARNESSES)("never list a removed node:test project, under %s", async (harness) => {
    const r = repoFor({
      policy: { nodeTest: [SCRIPTS] },
      files: [{ project: "removed-node", path: "scripts/old.test.mjs" }],
    });
    const text = primerOf(await sessionStart(r, harness)).primer;
    expect(text).not.toContain("removed-node");
    expect(text).toContain(
      `Squeal covers Vitest (vitest.config.ts) and node:test project "scripts" (scripts/*.test.mjs). ${NOT_COVERED}`,
    );
  });

  it.each(HARNESSES)(
    "count slow files as of the daemon's last listing, and none of a runner it no longer builds, under %s",
    async (harness) => {
      const r = repoFor({
        policy: { nodeTest: [{ ...SCRIPTS, slow: true }], slow: { include: ["test/slow/**"] } },
        vitestConfig: false,
        replace: true,
        files: [
          { project: "scripts", path: "scripts/a.test.mjs" },
          { project: "", path: "test/slow/vitest-before.test.ts" },
        ],
      });
      const text = primerOf(await sessionStart(r, harness)).primer;
      expect(text).toContain(
        `Squeal covers node:test project "scripts" (scripts/*.test.mjs), with 1 slow test file at the daemon's last listing. ${NOT_COVERED}`,
      );
      expect(text).not.toContain("Vitest");
    },
  );
});

/** A Codex CLI under `root`, with every slow sentence and a long node:test list. */
const longRoots = {
  "a 250-character directory": `/home/agent/${"x".repeat(250)}/.codex/plugins/cache/hearsay/squeal/0.1.109`,
  // PATH_MAX: 4,096 bytes with its terminator, in components within NAME_MAX.
  "the longest valid path":
    `/${Array.from({ length: 15 }, () => "y".repeat(255)).join("/")}/${"z".repeat(239)}`.slice(
      0,
      4_095,
    ),
};
const many = Array.from({ length: 30 }, (_, i) => ({
  name: `suite-${i}`,
  include: [`packages/suite-${i}/test/**/*.test.mjs`],
}));
const coverages: Record<string, Coverage> = {
  "slow, no projects": { vitest: true, vitestConfig: null, nodeTest: [], slow: { files: 3 } },
  "slow, many projects": {
    vitest: true,
    vitestConfig: "vitest.config.ts",
    nodeTest: many,
    slow: { files: 12 },
  },
};
const cases = Object.entries(longRoots).flatMap(([root, path]) =>
  Object.keys(coverages).map((coverage) => [root, coverage, path] as const),
);

describe("a long Codex CLI path (review wave 13aa, B3)", () => {
  it.each(cases)("%s, %s: the primer fits its cap, whole", (_, name, root) => {
    const command = codexCommand({ PLUGIN_ROOT: root }, "/unused.mjs");
    const text = primer(command, coverages[name] as Coverage);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toMatch(
      / Squeal covers Vitest.*, with \d+ slow test files at the daemon's last listing\. Squeal does not/,
    );
    expect(text.endsWith(` ${NOT_COVERED}`)).toBe(true);
    // A Codex hook's cut over 8,000 characters keeps the whole primer.
    const capped = capContext(`${"a".repeat(9_000)}\n\n${text}`, command);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(`\n\n${text}`)).toBe(true);
  });

  it("SessionStart under Codex keeps the slow primer whole with a long PLUGIN_ROOT", async () => {
    const command = codexCommand(
      { PLUGIN_ROOT: longRoots["a 250-character directory"] },
      "/unused.mjs",
    );
    const r = repoFor({
      policy: { slow: { include: ["test/slow/**"] } },
      replace: true,
      files: [{ project: "", path: "test/slow/a.test.ts" }],
    });
    const text = primerOf(await sessionStart(r, "codex", command)).primer;
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toContain(
      `Squeal covers Vitest (vitest.config.ts), with 1 slow test file at the daemon's last listing. ${NOT_COVERED}`,
    );
  });
});
