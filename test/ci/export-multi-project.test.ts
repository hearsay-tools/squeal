import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { committedBlobs } from "../../src/core/commit/tree.js";
import { encodeSegment, keyFromSegments } from "../../src/core/keys/check-key.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import { daemonExport, partsExport } from "./export-harness.js";
import { ci, cloneOf, committed, recordVitest, scratch } from "./fixture.js";

/*
 * Spec 018 D9, row 018-78 (#276): `squeal ci export` takes the parts of two
 * independent sharded Vitest runs of one commit over disjoint projects, each
 * run a complete shard set of its own count. A fixture of three projects is
 * recorded as `server` and `web` in two shards, and as `e2e` in two shards
 * and in three, one of them empty; each union exports what a daemon that ran
 * every project exports, and a missing shard of either run is refused.
 */

const PROJECTS = { server: ["s1", "s2"], web: ["w1", "w2"], e2e: ["e1", "e2"] };

/** Each project's test files read their own data file and import one source file. */
function fixture(dir: string): string {
  const projects = Object.keys(PROJECTS)
    .map((name) => `{ test: { name: "${name}", include: ["${name}/**/*.test.ts"] } }`)
    .join(", ");
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-multi-project", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { passWithNoTests: true, projects: [${projects}] } });\n`,
    "src/upper.ts": "export const upper = (text: string): string => text.toUpperCase();\n",
    ...Object.fromEntries(
      Object.entries(PROJECTS).flatMap(([project, names]) =>
        names.flatMap((name) => [
          [`data/${name}.txt`, `${name}\n`],
          [
            `${project}/${name}.test.ts`,
            `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { upper } from "../src/upper.js";\nit("reads ${name}", () => {\n  expect(upper(readFileSync(new URL("../data/${name}.txt", import.meta.url), "utf8"))).toBe("${name.toUpperCase()}\\n");\n});\n`,
          ],
        ]),
      ),
    ),
  });
}

/** The parts of `count` shards of a run of `projects`, recorded as in CI into `out`. */
async function record(root: string, out: string, projects: string[], count: number) {
  const only = projects.map((p) => `--project=${p}`);
  for (let index = 1; index <= count; index++) {
    const args = [...only, `--shard=${index}/${count}`];
    const recorded = await recordVitest(root, out, args);
    expect(recorded.code, recorded.said).toBe(0);
  }
  expect(readdirSync(out)).toHaveLength(count);
}

/** A directory holding the parts of `dirs`, but those `skip` names by index in its dir. */
function union(to: string, dirs: readonly string[], skip: [number, number] | null = null): string {
  mkdirSync(to, { recursive: true });
  dirs.forEach((dir, d) => {
    readdirSync(dir)
      .sort()
      .forEach((name, i) => {
        if (skip !== null && skip[0] === d && skip[1] === i) return;
        copyFileSync(join(dir, name), join(to, name));
      });
  });
  return to;
}

/** The import's proof (018 D11), as `export.test.ts` checks it. */
async function proven(root: string, bundle: ResultsBundle): Promise<boolean[]> {
  const blobs = await committedBlobs(root, bundle.header.commit as string);
  const hash = new Map(bundle.environments.map((e) => [e.project, e.hash]));
  return bundle.testFiles.map((file) => {
    const segments = (file.closure?.paths ?? []).map((p) => encodeSegment(p, blobs.get(p) ?? null));
    const { dependencies, runtime } = file.keyParts ?? { dependencies: "", runtime: "" };
    const at = keyFromSegments(hash.get(file.project) ?? "", file, segments, dependencies, runtime);
    return at === file.key;
  });
}

const files = (bundle: ResultsBundle) => bundle.testFiles.map(({ keyParts: _p, ...file }) => file);
const results = (bundle: ResultsBundle) =>
  bundle.results.map(({ durationMs: _ms, ...result }) => result);
const sorted = <T extends { project: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => a.project.localeCompare(b.project));

describe("squeal ci export of disjoint sharded project sets (#276, row 018-78)", () => {
  it("exports two sharded runs as the daemon does, and refuses a missing shard of either", {
    timeout: 600_000,
  }, async () => {
    const origin = fixture(scratch("ci-multi-project"));
    const base = dirname(origin);
    const app = join(base, "app");
    const e2eTwo = join(base, "e2e-2");
    const e2eThree = join(base, "e2e-3");
    await record(origin, app, ["server", "web"], 2);
    await record(origin, e2eTwo, ["e2e"], 2);
    // Two files in three shards: one shard is empty.
    await record(origin, e2eThree, ["e2e"], 3);

    const { bundle: daemon } = await daemonExport(origin);
    expect(daemon.testFiles).toHaveLength(6);
    for (const [name, dirs] of [
      ["equal", [app, e2eTwo]],
      ["mixed", [app, e2eThree]],
    ] as const) {
      // `partsExport` clones beside its origin, so each job has an origin of its own.
      const at = cloneOf(origin, `${name}-job/origin`);
      const job = await partsExport(at, union(join(base, name), dirs));
      if (!("bundle" in job)) throw new Error(`${name}: ${job.refused.text}`);
      expect(job.counts.testFiles, name).toBe(6);
      expect(job.counts.uncertified, JSON.stringify(job.uncertified)).toBe(0);
      expect(files(job.bundle)).toEqual(files(daemon));
      expect(results(job.bundle)).toEqual(results(daemon));
      expect(sorted(job.bundle.environments)).toEqual(sorted(daemon.environments));
      expect(await proven(job.root, job.bundle)).toEqual(daemon.testFiles.map(() => true));
    }

    for (const [name, skip, text] of [
      ["no-app", [0, 0], `projects "server", "web": no part of shard`],
      ["no-e2e", [1, 2], `projects "e2e": no part of shard`],
    ] as const) {
      const parts = union(join(base, name), [app, e2eThree], [...skip]);
      const command = await ci(["export", "--parts", parts], origin);
      expect(command.code, command.said).not.toBe(0);
      expect(command.said).toContain(text);
    }
  });
});
