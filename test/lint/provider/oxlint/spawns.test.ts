import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LintRunReport } from "../../../../src/core/lint/pass/provider.js";
import { memoryBacking, OxlintCache } from "../../../../src/core/lint/provider/oxlint/cache.js";
import type { OxlintProvider } from "../../../../src/core/lint/provider/oxlint/provider.js";
import type { AbsolutePath, RelativePath } from "../../../../src/core/types/common.js";
import { project, provider, scratch, write } from "../../oxlint/helpers.js";

/*
 * Spec 026 D3: one oxlint process on the common edit path. `--print-config`
 * is cached by the config files' blobs and `--debug files` by the path under
 * the same key, in memory and in the backing a short-lived daemon finds
 * again (`lint.sqlite`). Each oxlint process is counted by a `node` wrapper
 * that logs its arguments before it runs the real Node.
 */

const p = (path: string) => path as RelativePath;
const json = (o: unknown) => `${JSON.stringify(o)}\n`;
const CONFIG = json({ plugins: ["eslint"], rules: { "no-debugger": "error" } });

/** A `node` that logs one line per oxlint process: its arguments. */
function countingNode(): { node: string; spawns: () => string[]; reset: () => void } {
  const dir = scratch("squeal-oxlint-spawns-");
  const log = join(dir, "spawns.log");
  const node = join(dir, "node.sh");
  writeFileSync(log, "");
  writeFileSync(
    node,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexec '${process.execPath}' "$@"\n`,
  );
  chmodSync(node, 0o755);
  return {
    node,
    spawns: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((l) => l !== ""),
    reset: () => writeFileSync(log, ""),
  };
}

const kind = (line: string) =>
  line.includes("--print-config")
    ? "print-config"
    : line.includes("--debug files")
      ? "debug-files"
      : "lint";

function report(r: LintRunReport | { off: string }): LintRunReport {
  if ("off" in r) throw new Error(r.off);
  return r;
}

/** One pass as the lint pass runs it: refresh, inputs, then lint of the linted ones. */
async function pass(
  lint: OxlintProvider,
  root: AbsolutePath,
  paths: readonly string[],
  level: "none" | "instance" = "none",
) {
  const snapshot = await lint.refresh(level);
  if ("off" in snapshot) throw new Error(snapshot.off);
  const inputs = await lint.inputs(paths.map(p));
  const files = [...inputs.keys()].map((path) => ({
    path,
    text: readFileSync(join(root, path), "utf8"),
  }));
  return { inputs, report: report(await lint.lint(files)) };
}

describe("spec 026 D3: oxlint processes per pass", { timeout: 60_000 }, () => {
  it("runs one oxlint process for an edit while the configs are unchanged", async () => {
    const root = project({ ".oxlintrc.json": CONFIG, "src/a.js": "export const a = 1;\n" });
    const counter = countingNode();
    const cache = new OxlintCache(memoryBacking());
    const lint = provider(root, { node: counter.node, cache });
    await lint.open();
    await pass(lint, root, ["src/a.js"]);
    expect(counter.spawns().map(kind).sort()).toEqual(["debug-files", "lint", "print-config"]);

    counter.reset();
    write(root, { "src/a.js": "debugger;\n" });
    const edited = await pass(lint, root, ["src/a.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint"]);
    expect(edited.report.results.get(p("src/a.js"))).toMatchObject({
      findings: [{ rule: "eslint(no-debugger)" }],
    });
  });

  it("runs one oxlint process for a new included file while the configs are unchanged (review 0.1.616 B3)", async () => {
    const root = project({
      ".oxlintrc.json": CONFIG,
      "src/a.js": "export const a = 1;\n",
      "src/b.js": "debugger;\n",
    });
    const counter = countingNode();
    const lint = provider(root, { node: counter.node, cache: new OxlintCache(memoryBacking()) });
    await lint.open();
    await pass(lint, root, ["src/a.js"]);

    counter.reset();
    const unseen = await pass(lint, root, ["src/b.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint"]);
    expect([...unseen.inputs.keys()]).toEqual(["src/b.js"]);
    expect(unseen.report.results.get(p("src/b.js"))).toMatchObject({
      findings: [{ rule: "eslint(no-debugger)" }],
    });

    // The lint report's count answered for it: the next pass asks nothing more.
    counter.reset();
    await pass(lint, root, ["src/b.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint"]);
  });

  it("classifies a new ignored file under unchanged configs from the lint report, once", async () => {
    const root = project({
      ".oxlintrc.json": json({ ignorePatterns: ["src/gen.js"], rules: {} }),
      "src/a.js": "export const a = 1;\n",
      "src/gen.js": "export const g = 1;\n",
    });
    const counter = countingNode();
    const lint = provider(root, { node: counter.node, cache: new OxlintCache(memoryBacking()) });
    await lint.open();
    await pass(lint, root, ["src/a.js"]);

    counter.reset();
    const unseen = await pass(lint, root, ["src/a.js", "src/gen.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint", "debug-files"]);
    expect(unseen.report.results.get(p("src/a.js"))).toEqual({ findings: [] });
    expect(unseen.report.results.get(p("src/gen.js"))).toEqual({
      unknown: "oxlint does not lint it now",
    });

    counter.reset();
    const after = await pass(lint, root, ["src/a.js", "src/gen.js"]);
    expect([...after.inputs.keys()]).toEqual(["src/a.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint"]);
  });

  it("runs one oxlint process after a restart that finds the cache's backing", async () => {
    const root = project({ ".oxlintrc.json": CONFIG, "src/a.js": "export const a = 1;\n" });
    const backing = memoryBacking();
    const first = provider(root, { cache: new OxlintCache(backing) });
    await first.open();
    const before = await pass(first, root, ["src/a.js"]);
    await first.close();

    // A short-lived daemon's next start: new memory, the same backing (D2).
    const counter = countingNode();
    const second = provider(root, { node: counter.node, cache: new OxlintCache(backing) });
    await second.open();
    const after = await pass(second, root, ["src/a.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint"]);
    expect(after.report.closure).toEqual(before.report.closure);
    expect([...after.inputs]).toEqual([...before.inputs]);
  });

  it("reads the config again at once when a config's bytes change", async () => {
    const root = project({ ".oxlintrc.json": CONFIG, "src/a.js": "debugger;\n" });
    const counter = countingNode();
    const lint = provider(root, { node: counter.node, cache: new OxlintCache(memoryBacking()) });
    await lint.open();
    await pass(lint, root, ["src/a.js"]);

    counter.reset();
    write(root, {
      ".oxlintrc.json": json({ plugins: ["eslint"], rules: { "no-debugger": "off" } }),
    });
    const changed = await pass(lint, root, ["src/a.js"], "instance");
    expect(counter.spawns().map(kind).sort()).toEqual(["debug-files", "lint", "print-config"]);
    expect(changed.report.results.get(p("src/a.js"))).toEqual({ findings: [] });
  });

  it("classifies an ignored file as before, from the cached classification too", async () => {
    const root = project({
      ".oxlintrc.json": json({ ignorePatterns: ["src/gen.js"], rules: {} }),
      "src/a.js": "export const a = 1;\n",
      "src/gen.js": "export const g = 1;\n",
    });
    const backing = memoryBacking();
    const counter = countingNode();
    const first = provider(root, { node: counter.node, cache: new OxlintCache(backing) });
    await first.open();
    const before = await pass(first, root, ["src/a.js", "src/gen.js"]);
    expect([...before.inputs.keys()]).toEqual(["src/a.js"]);
    await first.close();

    counter.reset();
    const second = provider(root, { node: counter.node, cache: new OxlintCache(backing) });
    await second.open();
    const after = await pass(second, root, ["src/a.js", "src/gen.js"]);
    expect([...after.inputs.keys()]).toEqual(["src/a.js"]);
    expect(counter.spawns().map(kind)).toEqual(["lint"]);
  });

  it("classifies a file a new ignore pattern names as ignored, not from the old classification", async () => {
    const root = project({ ".oxlintrc.json": CONFIG, "src/a.js": "export const a = 1;\n" });
    const lint = provider(root, { cache: new OxlintCache(memoryBacking()) });
    await lint.open();
    expect([...(await pass(lint, root, ["src/a.js"])).inputs.keys()]).toEqual(["src/a.js"]);
    write(root, { ".oxlintrc.json": json({ ignorePatterns: ["src/a.js"], rules: {} }) });
    expect([...(await pass(lint, root, ["src/a.js"], "instance")).inputs.keys()]).toEqual([]);
  });

  it("runs `--debug files` when oxlint lints fewer files than named, and keeps its answer", async () => {
    const root = project({
      ".oxlintrc.json": json({ ignorePatterns: ["src/gen.js"], rules: {} }),
      "src/a.js": "export const a = 1;\n",
      "src/gen.js": "export const g = 1;\n",
    });
    const counter = countingNode();
    const lint = provider(root, { node: counter.node, cache: new OxlintCache(memoryBacking()) });
    await lint.open();
    await lint.refresh("none");
    counter.reset();
    // A lint the pass's inputs did not answer for: the classification falls back to `--debug files`.
    const files = ["src/a.js", "src/gen.js"].map((path) => ({
      path: p(path),
      text: readFileSync(join(root, path), "utf8"),
    }));
    const given = report(await lint.lint(files));
    expect(given.results.get(p("src/a.js"))).toEqual({ findings: [] });
    expect(given.results.get(p("src/gen.js"))).toEqual({ unknown: "oxlint does not lint it now" });
    expect(counter.spawns().map(kind)).toEqual(["lint", "debug-files"]);

    counter.reset();
    expect([...(await lint.inputs([p("src/gen.js")])).keys()]).toEqual([]);
    expect(counter.spawns()).toEqual([]);
  });

  it("does not cache a config whose `--print-config` run failed", async () => {
    const root = project({ ".oxlintrc.json": "{ not json", "src/a.js": "export const a = 1;\n" });
    const backing = memoryBacking();
    const lint = provider(root, { cache: new OxlintCache(backing) });
    await lint.open();
    await lint.refresh("none");
    expect(backing.size()).toBe(0);
  });
});
