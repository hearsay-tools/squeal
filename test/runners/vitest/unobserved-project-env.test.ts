import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeRecorder } from "../../../src/runners/observe/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, ref, SLOW } from "./helpers.js";

/*
 * Review wave 6, B2 (spec 001 D11 Fidelity and D3, task 001-431): an
 * instance that does not observe takes another Squeal's recorder out of the
 * `NODE_OPTIONS` its workers inherit, and leaves a project's own
 * `env.NODE_OPTIONS` as the project set it: in the workers, and in the
 * resolved config its environment hash reads, alike with the outer recorder
 * and without it.
 */
const recorder = observeRecorder(
  new URL("../../../src/runners/observe/runtime.ts", import.meta.url),
) as string;
const INHERITED = "--conditions=outer";

const TEST = `import { expect, it } from "vitest";
it("sees the NODE_OPTIONS its project gives it", () => {
  expect(process.env.NODE_OPTIONS).toBe(process.env.EXPECTED_NODE_OPTIONS);
});
`;

const ROOT = `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/env.test.ts"],
    testTimeout: 60_000,
    env: { NODE_OPTIONS: "--conditions=project", EXPECTED_NODE_OPTIONS: "--conditions=project" },
  },
});
`;

const PROJECTS = `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    testTimeout: 60_000,
    projects: [
      {
        test: {
          name: "own",
          include: ["test/env.test.ts"],
          env: { NODE_OPTIONS: "--conditions=own", EXPECTED_NODE_OPTIONS: "--conditions=own" },
        },
      },
      {
        test: {
          name: "none",
          include: ["test/env.test.ts"],
          env: { EXPECTED_NODE_OPTIONS: "${INHERITED}" },
        },
      },
    ],
  },
});
`;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The outcome per project and each project's resolved config, with or without the outer recorder. */
async function runUnder(config: string, projects: readonly string[], outer: boolean) {
  const out = mkdtempSync(join(tmpdir(), "squeal-outer-"));
  try {
    vi.stubEnv(
      "NODE_OPTIONS",
      outer ? `--import ${pathToFileURL(recorder).href} ${INHERITED}` : INHERITED,
    );
    vi.stubEnv(
      "SQUEAL_OBSERVE",
      outer ? JSON.stringify({ out, root: process.cwd(), skip: [] }) : undefined,
    );
    const fx = await openFixture(
      "basic",
      { "vitest.config.ts": config, "test/env.test.ts": TEST },
      (root) => createVitestAdapter({ root, observe: () => false }),
    );
    const report = await fx.adapter.run(
      projects.map((project) => ref("test/env.test.ts", project)),
      fx.runOptions(),
    );
    const configs = (await fx.adapter.environment()).map((e) => [e.project, e.resolvedConfig]);
    return {
      outcomes: report.results.map((r) => [r.check.project, r.outcome, r.errors[0]?.message]),
      configs,
    };
  } finally {
    vi.unstubAllEnvs();
    rmSync(out, { recursive: true, force: true });
  }
}

describe(
  "vitest adapter: a project's own NODE_OPTIONS under another Squeal's recorder (review wave 6, B2)",
  SLOW,
  () => {
    it.each([
      ["a root config's", ROOT, [""], ["--conditions=project"]],
      ["a project's, beside one that sets none", PROJECTS, ["own", "none"], ["--conditions=own"]],
      // The value the workers would inherit anyway, still the config's: keyed with or without the recorder.
      [
        "a root config's equal to the inherited",
        ROOT.replaceAll("--conditions=project", INHERITED),
        [""],
        [INHERITED],
      ],
    ])("keeps %s in the workers and the hash", async (_, config, projects, own) => {
      const nested = await runUnder(config, projects, true);
      const plain = await runUnder(config, projects, false);
      for (const [project, outcome, message] of nested.outcomes)
        expect([project, outcome, message]).toEqual([project, "pass", undefined]);
      expect(nested.configs).toEqual(plain.configs);
      for (const value of own)
        expect(nested.configs.some(([, resolved]) => resolved?.includes(value))).toBe(true);
    });
  },
);
