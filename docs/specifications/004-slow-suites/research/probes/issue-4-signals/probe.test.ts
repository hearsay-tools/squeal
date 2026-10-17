// Throwaway probe for hearsay-tools/squeal#4 (research/issue-4-signals.md). Not product code.
//
// The issue-4-ranking probe's cezarion shape (77 slow files, CI durations / SCALE, declared inputs
// packages/web/src/** and packages/web/e2e/**, slow.maxWorkers 1, slow.maxParallel 1), plus a shared
// helper github-fixture.ts that the seven specs importing it at cezarion d88c8c1d3 import. It drives the
// real Scheduler over a real Vitest adapter and records the slow tier's order after:
//   1. a markdown.tsx edit on a fresh store (warm-up: durations become known);
//   2. an edit to the helper: does today's `direct` class (the runner's one-hop importers) lead?
//   3. a markdown.tsx edit followed by a named wait's promotion (spec 011 C15) of artifact-project-links.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, it } from "vitest";
import { DEFAULT_POLICY, type Policy } from "../../../../../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore } from "../../../../../../test/scheduler/helpers.js";

const here = import.meta.dirname;
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const SCALE = Number(process.env.PROBE_SCALE ?? 100);
const E2E = "packages/web/e2e";
const MARKDOWN = "packages/web/src/routes/task-thread/markdown.tsx";
const HELPER = `${E2E}/github-fixture.ts`;
const WANTED = "artifact-project-links.e2e.ts";
// `git grep -l "from './github-fixture'" d88c8c1d3 -- 'packages/web/e2e/*.e2e.ts'` (signals.mjs, E3).
const HELPER_IMPORTERS = [
  "git-sidebar.e2e.ts",
  "github-core.e2e.ts",
  "github-layout.e2e.ts",
  "github-pr-review.e2e.ts",
  "github-sidebar.e2e.ts",
  "github-states.e2e.ts",
  "issue-linked-tasks.e2e.ts",
];
const durations = JSON.parse(
  readFileSync(join(here, "..", "issue-4-ranking", "ci-durations.json"), "utf8"),
) as Record<string, number>;
const names = Object.keys(durations).sort();

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function createShape(): { main: string; commonDir: string } {
  const dir = join(here, ".tmp");
  mkdirSync(dir, { recursive: true });
  const main = mkdtempSync(join(dir, "repo-"));
  put(main, "package.json", `{ "name": "issue-4-signals-probe", "private": true, "type": "module" }\n`);
  put(main, ".gitignore", "node_modules\n");
  put(
    main,
    "vitest.config.ts",
    `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["${E2E}/*.e2e.ts"], testTimeout: 60_000 } });\n`,
  );
  put(main, HELPER, `export const clickGitHubTab = (path: string) => path;\n`);
  for (const name of names) {
    const ms = Math.max(1, Math.round(durations[name]! / SCALE));
    const helper = HELPER_IMPORTERS.includes(name) ? `import { clickGitHubTab } from "./github-fixture";\nclickGitHubTab("/github");\n` : "";
    put(
      main,
      `${E2E}/${name}`,
      `import { it } from "vitest";\n${helper}it("${name}", async () => {\n  await new Promise((r) => setTimeout(r, ${ms}));\n});\n`,
    );
  }
  put(main, MARKDOWN, `export const Markdown = () => '<div class="thread-markdown">';\n`);
  const git = (args: string[]) => execFileSync("git", args, { cwd: main, stdio: "ignore" });
  git(["init", "-q", "-b", "main"]);
  git(["add", "-A"]);
  git(["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "fixture"]);
  const real = realpathSync(main);
  return { main: real, commonDir: join(real, ".git") };
}

function policy(): Partial<Policy> {
  return {
    baseline: { ...DEFAULT_POLICY.baseline, onStart: "lookup-only" },
    slow: { ...DEFAULT_POLICY.slow, include: [`${E2E}/*.e2e.ts`], maxWorkers: 1, maxParallel: 1 },
    inputs: { [`${E2E}/*.e2e.ts`]: ["packages/web/src/**", `${E2E}/**`] },
  };
}

const base = (path: string) => path.slice(E2E.length + 1);

async function editAndRecord(h: Harness, path: string, label: string, promote: string | null) {
  const start = h.runner.runs.length;
  const content = readFileSync(join(h.root, path), "utf8");
  h.write(path, `${content}// edit ${label}\n`);
  await h.batch(path);
  // A named wait sends `promote` beside its first read once the revision is listed (C15, task 011-11).
  if (promote) await h.scheduler.promote([{ project: "", path: `${E2E}/${promote}` }], 600_000);
  await h.scheduler.idle();
  let runs = h.runner.runs.slice(start);
  let requested = false;
  if (runs.length === 0) {
    requested = true;
    await h.scheduler.requestSlowSuite();
    await h.scheduler.idle();
    runs = h.runner.runs.slice(start);
  }
  const order = runs.map((run) => run.files.map((f) => base(f.path)).join("+"));
  const at = (n: string) => order.indexOf(n) + 1;
  return {
    label,
    edited: path,
    promoted: promote,
    requestedSlowSuite: requested,
    runs: order.length,
    order,
    positionOfWanted: at(WANTED),
    positionsOfHelperImporters: Object.fromEntries(HELPER_IMPORTERS.map((n) => [n, at(n)])),
  };
}

it("records the slow tier's order after a helper edit and a promoted markdown edit (issue 4)", { timeout: 1_800_000 }, async () => {
  const repo = createShape();
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-issue-4-signals-slot-"));
  try {
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: policy(),
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const passes = [];
    passes.push(await editAndRecord(h, MARKDOWN, "1 markdown, warm-up, no durations known", null));
    passes.push(await editAndRecord(h, HELPER, "2 helper github-fixture.ts, durations known", null));
    passes.push(await editAndRecord(h, MARKDOWN, `3 markdown, named wait promotes ${WANTED}`, WANTED));
    const out = {
      at: new Date().toISOString(),
      squealCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(here) }).toString().trim(),
      node: process.version,
      scale: SCALE,
      passes,
    };
    const file = join(here, "logs", `run-${out.at.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`wrote ${file}`);
    for (const p of passes)
      console.log(
        `${p.label}: runs ${p.runs}, requested ${p.requestedSlowSuite}, wanted at ${p.positionOfWanted}, ` +
          `helper importers at ${JSON.stringify(Object.values(p.positionsOfHelperImporters))}, first eight ${p.order.slice(0, 8).join(", ")}`,
      );
  } finally {
    scratch.push(slotDir, repo.main);
  }
});
