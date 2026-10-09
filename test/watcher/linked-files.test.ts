import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit, splitNul } from "../../src/core/fs/index.js";
import { candidatesForReconcile } from "../../src/core/watcher/candidates.js";
import { Exclusions } from "../../src/core/watcher/exclusions.js";
import { buildWatchSpec } from "../../src/core/watcher/index.js";
import { linkedFiles } from "../../src/core/watcher/linked-files.js";
import { git, makeRepo } from "./helpers.js";

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

/* Task 001-166: the start seed takes what the feed's first pass walks under a link. */
describe("linkedFiles", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it("lists what a reconciliation pass walks under the links git lists, and nothing else", async () => {
    const repo = makeRepo();
    cleanup = repo.cleanup;
    const { root } = repo;
    write(root, ".claude/skills/w/SKILL.md");
    write(root, ".claude/skills/w/references/a.md");
    write(root, "../outside/b.ts");
    write(root, "build/out.js");
    write(root, ".gitignore", "build/\nignored-link\n");
    mkdirSync(join(root, ".agents/skills"), { recursive: true });
    symlinkSync("../../.claude/skills/w", join(root, ".agents/skills/w"));
    symlinkSync("../outside", join(root, "lib"));
    symlinkSync("build", join(root, "ignored-link"));
    git(root, "add", "-A");
    git(root, "commit", "-qm", "links");

    const listed = splitNul(
      await runGit(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
    );
    const found = await linkedFiles(root, listed);
    expect(found.sort()).toEqual([
      ".agents/skills/w/SKILL.md",
      ".agents/skills/w/references/a.md",
      "lib/b.ts",
    ]);

    const spec = await buildWatchSpec(root);
    const pass = await candidatesForReconcile(
      {
        root,
        exclusions: new Exclusions(spec),
        extraFiles: new Set(),
        trackedPaths: () => listed,
      },
      [],
    );
    const walked = pass.paths.map((p) => p.path).filter((path) => !listed.includes(path));
    expect(walked).toEqual(found.sort());
  });

  it("finds nothing without a linked directory", async () => {
    const repo = makeRepo();
    cleanup = repo.cleanup;
    expect(await linkedFiles(repo.root, ["README.md"])).toEqual([]);
  });
});
