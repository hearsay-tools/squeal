import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, onTestFinished } from "vitest";
import { blobHash } from "../../../../src/core/hash/index.js";
import type { LintSource, LintSourceFile } from "../../../../src/core/lint/pass/index.js";
import { createLintPass } from "../../../../src/core/lint/pass/index.js";
import { findConfigs } from "../../../../src/core/lint/provider/oxlint/configs.js";
import { oxlintProvider } from "../../../../src/core/lint/provider/oxlint/index.js";
import type { AbsolutePath, RelativePath } from "../../../../src/core/types/index.js";
import { commonDir, LINT_ON, open } from "../../helpers.js";
import { project, write } from "../../oxlint/helpers.js";

/*
 * Row 017-30 (`011-core/research/issue-154-cause.md` F5): a config in a
 * folder git ignores, such as cezarion's served clone
 * `.ai/qa/served/<task>/.oxlintrc.json`, decides no checked file, since the
 * pass never offers an ignored file (D1). So it is neither a key input nor a
 * config for tracked files, and a clone that appears or changes moves no key.
 * A tracked nested config still does.
 */

const WORKTREE = "w1";
const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
const rules = (rule: string, severity: string) =>
  json({ plugins: ["eslint"], rules: { [rule]: severity } });

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
}

/** A git repository with `files`, oxlint installed, `node_modules` ignored and the tracked files added. */
function repository(files: Readonly<Record<string, string>>, ignore: readonly string[]) {
  const root = project({ ".gitignore": ["node_modules/", ...ignore].join("\n") });
  git(root, "init", "-q", ".");
  write(root, files);
  git(root, "add", "-A");
  return root;
}

/**
 * The daemon's listing as the lint pass reads it (011 C2): tracked and
 * untracked files git does not ignore (`ls-files --cached --others
 * --exclude-standard`), one revision per `revise`.
 */
class GitWorktree {
  readonly #revisions: RelativePath[][] = [];
  #files = new Map<RelativePath, LintSourceFile>();

  constructor(readonly root: string) {}

  revise(): void {
    const listed = git(this.root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
      .split("\0")
      .filter((p) => p !== "") as RelativePath[];
    const next = new Map<RelativePath, LintSourceFile>();
    for (const path of listed) {
      next.set(path, { path, hash: blobHash(readFileSync(join(this.root, path)), "sha1") });
    }
    const paths = new Set([...next.keys(), ...this.#files.keys()]);
    const changed = [...paths].filter((p) => next.get(p)?.hash !== this.#files.get(p)?.hash);
    this.#files = next;
    this.#revisions.push(changed.sort());
  }

  readonly source: LintSource = {
    latestRevision: () => this.#revisions.length,
    changedPaths: (after, upTo) => [...new Set(this.#revisions.slice(after, upTo).flat())],
    file: (path) => this.#files.get(path) ?? null,
    files: () => [...this.#files.values()],
    ignored: () => [],
  };
}

/**
 * The real oxlint pass over a git worktree, its first pass run. `restart`
 * closes it and starts another on the same store, as a daemon restart does:
 * the provider reads its configs again (F4, F5).
 */
async function rig(root: AbsolutePath) {
  const worktree = new GitWorktree(root);
  const dir = commonDir();
  const start = () => {
    const made = createLintPass({
      worktreeId: WORKTREE,
      tool: "oxlint",
      root,
      commonDir: dir,
      format: "sha1",
      source: worktree.source,
      policy: () => LINT_ON,
      provider: () => oxlintProvider({ root, env: { PATH: process.env.PATH } }),
      installed: () => Promise.resolve("install-1"),
      idleIn: () => 0,
      log: () => {},
      onError: (error) => {
        throw error;
      },
    });
    onTestFinished(() => made.close());
    return made;
  };
  let pass = start();
  const store = open(dir);
  const settle = async () => {
    for (let round = 0; round < 40; round++) {
      pass.nudge();
      await pass.idle();
      const busy = store.states.list(WORKTREE).some((s) => s.outcome === "pending" || s.stale);
      if (!busy) return;
      await sleep(100);
    }
  };
  const revise = async () => {
    worktree.revise();
    await settle();
  };
  const restart = async () => {
    await pass.close();
    pass = start();
    await settle();
  };
  /** Each checked file's key and findings. */
  const keys = () =>
    Object.fromEntries(
      store.states.list(WORKTREE, { tool: "oxlint" }).map((s) => {
        const result = s.judged === null ? null : store.results.get(s.check, s.judged.key);
        const found = result?.findings.map((f) => `${f.rule} ${f.severity}`) ?? [s.outcome];
        return [s.check.path, { key: s.judged?.key ?? null, findings: found }];
      }),
    );
  await revise();
  return { revise, restart, keys };
}

describe("oxlint config discovery and folders git ignores (row 017-30)", () => {
  it("lists no config under an ignored folder, and keeps tracked nested ones", async () => {
    const root = repository(
      {
        ".oxlintrc.json": rules("no-debugger", "error"),
        "pkg/.oxlintrc.json": rules("no-debugger", "warn"),
        ".storybook/.oxlintrc.json": rules("no-debugger", "warn"),
        ".ai/qa/served/t1/.oxlintrc.json": rules("no-console", "error"),
        ".ai/qa/served/t1/src/.oxlintrc.json": rules("no-console", "error"),
        "dist/.oxlintrc.json": rules("no-console", "error"),
        // A folder the patterns ignore that holds a tracked file: its config decides that file.
        "vendor/kept/.oxlintrc.json": rules("no-console", "error"),
        "vendor/kept/a.js": "debugger;\n",
      },
      [".ai/qa/**", "dist/", "vendor/"],
    );
    git(root, "add", "-f", "vendor/kept/a.js");
    expect(await findConfigs(root)).toEqual([
      ".oxlintrc.json",
      ".storybook/.oxlintrc.json",
      "pkg/.oxlintrc.json",
      "vendor/kept/.oxlintrc.json",
    ]);
  });

  it("lists every config when git cannot list the ignored folders", async () => {
    // No repository of its own: under /tmp git finds none; under a checkout's ignored temp folder it fails.
    const root = project({
      ".gitignore": "dist/\n",
      ".oxlintrc.json": rules("no-debugger", "error"),
      "dist/.oxlintrc.json": rules("no-console", "error"),
    });
    expect(await findConfigs(root)).toEqual([".oxlintrc.json", "dist/.oxlintrc.json"]);
  });

  it("moves no key when a config appears or changes under an ignored folder; a tracked nested config still moves its files' keys", {
    timeout: 60_000,
  }, async () => {
    const root = repository(
      {
        ".oxlintrc.json": rules("no-debugger", "error"),
        "pkg/.oxlintrc.json": rules("no-debugger", "warn"),
        "src/a.js": "debugger;\n",
        "pkg/b.js": "debugger;\n",
      },
      [".ai/qa/**"],
    );
    const { revise, restart, keys } = await rig(root);
    const before = keys();
    expect(before).toMatchObject({
      "src/a.js": { findings: ["eslint(no-debugger) error"] },
      "pkg/b.js": { findings: ["eslint(no-debugger) warning"] },
    });
    expect(before["src/a.js"]?.key).not.toBeNull();

    // A served clone boots: its config and a nested one appear.
    write(root, {
      ".ai/qa/served/t1/.oxlintrc.json": rules("no-console", "error"),
      ".ai/qa/served/t1/src/.oxlintrc.json": rules("no-console", "error"),
      ".ai/qa/served/t1/src/c.js": "console.log(1);\n",
    });
    await revise();
    expect(keys()).toEqual(before);
    await restart();
    expect(keys()).toEqual(before);

    // The clone boots again with another config.
    write(root, { ".ai/qa/served/t1/.oxlintrc.json": rules("no-debugger", "off") });
    await revise();
    await restart();
    expect(keys()).toEqual(before);

    // A tracked nested config still moves the key of the files it decides.
    write(root, { "pkg/.oxlintrc.json": rules("no-debugger", "error") });
    await revise();
    const after = keys();
    expect(after["pkg/b.js"]).toMatchObject({ findings: ["eslint(no-debugger) error"] });
    expect(after["pkg/b.js"]?.key).not.toBe(before["pkg/b.js"]?.key);
  });
});
