// Throwaway probe for hearsay-tools/squeal#4 (research/issue-4-ranking.md). Not product code.
//
// Runs the real Scheduler (src/core/scheduler) over a real Vitest adapter on a
// generated repository shaped like hearsay-tools/cezarion at d88c8c1d3: 77
// slow files named as its packages/web/e2e/*.e2e.ts, keyed on packages/web/src/**
// by declared inputs, slow.maxWorkers 1, slow.maxParallel 1. Each spec sleeps
// its CI duration from run 38795107753 divided by SCALE. No browser, no build.
// It records the order the slow tier runs the files after an edit to
// markdown.tsx and after an edit to a diff component.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, it } from "vitest";
import { DEFAULT_POLICY, type Policy } from "../../../../../../src/core/types/index.js";
import { type Harness, openHarness, openRepoStore } from "../../../../../../test/scheduler/helpers.js";

const here = import.meta.dirname;
// The harness and store close in helpers.ts's afterEach; the scratch goes after them.
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const SCALE = Number(process.env.PROBE_SCALE ?? 100);
const E2E = "packages/web/e2e";
const MARKDOWN = "packages/web/src/routes/task-thread/markdown.tsx";
const DIFF = "packages/web/src/components/diff/diff-file.tsx";
const durations = JSON.parse(readFileSync(join(here, "ci-durations.json"), "utf8")) as Record<string, number>;
const names = Object.keys(durations).sort();

// Expected first, from the issue's comment: the spec that broke (#1076), then the
// grep in cezarion's AGENTS.md; for the diff edit, specs selecting data-slot="diff-…".
const EXPECTED_MARKDOWN_FIRST = "artifact-project-links.e2e.ts";
const MARKDOWN_TOKEN_SPECS = [
  "artifact-project-links.e2e.ts",
  "assistant-line-breaks.e2e.ts",
  "chat-code-fence.e2e.ts",
  "composer.e2e.ts",
  "task-files.e2e.ts",
  "task-thread.e2e.ts",
];
const DIFF_TOKEN_SPECS = [
  "commit-list.e2e.ts",
  "diff-scroll.e2e.ts",
  "git-sidebar.e2e.ts",
  "markdown-preview.e2e.ts",
  "quick-list.e2e.ts",
  "repo-git.e2e.ts",
  "review-gate.e2e.ts",
  "task-changes.e2e.ts",
  "variants-compare.e2e.ts",
];

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** The literal tokens a token ranking would match, as the real specs carry them. */
function tokensOf(name: string): string {
  const lines: string[] = [];
  if (name === EXPECTED_MARKDOWN_FIRST) {
    // artifact-project-links.e2e.ts:81 and :86-87 at d88c8c1d3.
    lines.push(`const selector = '[data-slot="user-bubble"] a[data-streamdown="link"]'`);
    lines.push(`const dialog = '[data-slot="link-safety-dialog"]'`);
    lines.push(`const url = '[data-slot="link-safety-url"]'`);
  } else if (MARKDOWN_TOKEN_SPECS.includes(name)) {
    lines.push(`const markdown = '.thread-markdown'`);
  }
  if (DIFF_TOKEN_SPECS.includes(name)) lines.push(`const diff = '[data-slot="diff-file"]'`);
  return lines.join("\n");
}

function createCezarionShape(): { main: string; commonDir: string } {
  const scratch = join(here, ".tmp");
  mkdirSync(scratch, { recursive: true });
  const main = mkdtempSync(join(scratch, "repo-"));
  put(main, "package.json", `{ "name": "issue-4-probe", "private": true, "type": "module" }\n`);
  put(main, ".gitignore", "node_modules\n");
  put(
    main,
    "vitest.config.ts",
    `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["${E2E}/*.e2e.ts"], testTimeout: 60_000 } });\n`,
  );
  for (const name of names) {
    const ms = Math.max(1, Math.round(durations[name]! / SCALE));
    put(
      main,
      `${E2E}/${name}`,
      `import { it } from "vitest";\n${tokensOf(name)}\nit("${name}", async () => {\n  await new Promise((r) => setTimeout(r, ${ms}));\n});\n`,
    );
  }
  // Sources no spec imports, as in cezarion: the specs reach them through a page.
  put(main, "packages/web/src/routes/task-thread/task-link.tsx", `export const TaskLink = () => '<a data-streamdown="link">';\n`);
  put(
    main,
    "packages/web/src/routes/task-thread/link-safety-dialog.tsx",
    `export const LinkSafetyDialog = () => '<div data-slot="link-safety-dialog"><span data-slot="link-safety-url">';\n`,
  );
  put(
    main,
    MARKDOWN,
    `import { TaskLink } from "./task-link";\nimport { LinkSafetyDialog } from "./link-safety-dialog";\nexport const Markdown = () => ['<div class="thread-markdown">', TaskLink(), LinkSafetyDialog()];\n`,
  );
  put(main, DIFF, `export const DiffFile = () => '<div data-slot="diff-file">';\n`);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "fixture"]);
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

/** Squeal's stored duration per spec under its current key (`durationOf` sums result durations). */
function storedDurations(h: Harness): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const name of names) {
    const key = h.keyOf(`${E2E}/${name}`);
    const results = key === null ? [] : h.store.results.byKey(key, Date.now());
    out.set(name, results.length === 0 ? null : results.reduce((s, r) => s + r.durationMs, 0));
  }
  return out;
}

/** Shortest known duration first, unknown last, then path: the order queue.ts predicts when class and recency tie. */
function predicted(known: Map<string, number | null>): string[] {
  const d = (n: string) => known.get(n) ?? Number.POSITIVE_INFINITY;
  return [...names].sort((a, b) => (d(a) === d(b) ? (a < b ? -1 : 1) : d(a) - d(b)));
}

async function editAndRecord(h: Harness, path: string, label: string) {
  const before = storedDurations(h);
  const start = h.runner.runs.length;
  const content = readFileSync(join(h.root, path), "utf8");
  h.write(path, `${content}// edit ${label}\n`);
  await h.batch(path);
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
  const prediction = predicted(before);
  const at = (n: string) => order.indexOf(n) + 1;
  return {
    label,
    edited: path,
    requestedSlowSuite: requested,
    runs: order.length,
    filesPerRun: [...new Set(runs.map((r) => r.files.length))],
    order,
    matchesShortestKnownFirstThenPath: JSON.stringify(order) === JSON.stringify(prediction),
    firstMismatch: order.findIndex((n, i) => n !== prediction[i]),
    positionOfIssueExpected: label.startsWith("markdown") ? at(EXPECTED_MARKDOWN_FIRST) : null,
    positionsOfTokenSpecs: Object.fromEntries(
      (label.startsWith("markdown") ? MARKDOWN_TOKEN_SPECS : DIFF_TOKEN_SPECS).map((n) => [n, at(n)]),
    ),
    knownDurationsBefore: [...before.values()].filter((v) => v !== null).length,
  };
}

it("records the slow tier's order after a source edit (issue 4)", { timeout: 1_800_000 }, async () => {
  const repo = createCezarionShape();
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-issue-4-slot-"));
  try {
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: policy(),
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    const startRuns = h.runner.runs.length;
    const passes = [];
    // 1. Cezarion's `baseline.onStart: "lookup-only"` on a fresh store: no duration known.
    passes.push(await editAndRecord(h, MARKDOWN, "markdown, no durations known"));
    // 2. Durations now known from pass 1: an edit to a diff component.
    passes.push(await editAndRecord(h, DIFF, "diff, durations known"));
    // 3. The same markdown edit again, durations known.
    passes.push(await editAndRecord(h, MARKDOWN, "markdown, durations known"));
    const same = JSON.stringify(passes[1]!.order) === JSON.stringify(passes[2]!.order);
    // Passes 2 and 3 run on durations re-measured in between, so neighbours may swap.
    const third = new Map(passes[2]!.order.map((n, i) => [n, i]));
    const shifts = passes[1]!.order.map((n, i) => Math.abs(i - (third.get(n) ?? i)));
    const out = {
      at: new Date().toISOString(),
      squealCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve(here) }).toString().trim(),
      node: process.version,
      scale: SCALE,
      runsAtStart: startRuns,
      diffAndMarkdownOrdersIdentical: same,
      diffVsMarkdownSamePosition: shifts.filter((d) => d === 0).length,
      diffVsMarkdownMaxShift: Math.max(...shifts),
      passes,
    };
    const file = join(here, "logs", `run-${out.at.replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`wrote ${file}`);
    for (const p of passes) {
      console.log(
        `${p.label}: runs ${p.runs}, width ${p.filesPerRun}, requested ${p.requestedSlowSuite}, ` +
          `shortest-known-first-then-path ${p.matchesShortestKnownFirstThenPath} (first mismatch ${p.firstMismatch}), ` +
          `issue-expected at ${p.positionOfIssueExpected}, first five ${p.order.slice(0, 5).join(", ")}`,
      );
      console.log(`  token specs at ${JSON.stringify(p.positionsOfTokenSpecs)}`);
    }
    console.log(`diff and markdown orders identical (passes 2 and 3): ${same}`);
  } finally {
    scratch.push(slotDir, repo.main);
  }
});
