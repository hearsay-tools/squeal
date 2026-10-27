import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCommonDir, worktreeIdFor } from "../../src/core/fs/index.js";
import {
  argv0For,
  displayId,
  ownNodeArgv0,
  PROJECT_MAX,
  projectComponent,
  storeCheckLabel,
  worktreeLabel,
} from "../../src/core/process-label.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { fakeRepo } from "../status/helpers.js";
import { tempDir } from "../store/helpers.js";

/*
 * Spec 005 D3, project-first process commands (row 005-88): the label each
 * owned Node spawn gives as argv0 on Linux, its project from the common
 * directory's layout, and the node:test leader's guard, which labels only
 * this process's own Node, so a shim that reads argv0 keeps it.
 */

const real = (path: string) => realpathSync(path) as AbsolutePath;

/** A directory under a fresh temporary parent: `<tmp>/<name>`, a real path. */
function dirNamed(name: string): AbsolutePath {
  const dir = join(tempDir("squeal-label-"), name);
  mkdirSync(dir, { recursive: true });
  return real(dir);
}

describe("projectComponent", () => {
  it("keeps ASCII letters, digits, dot, underscore and hyphen", () => {
    expect(projectComponent("squeal_core-2.x")).toBe("squeal_core-2.x");
  });

  it("turns each run of other characters into one hyphen and trims edge hyphens", () => {
    expect(projectComponent("my project")).toBe("my-project");
    expect(projectComponent("  spaced\t\nout  ")).toBe("spaced-out");
    expect(projectComponent("zażółć gęślą")).toBe("za-g-l");
    expect(projectComponent("--flag--")).toBe("flag");
  });

  it("drops terminal escapes and control characters to printable ASCII", () => {
    const label = projectComponent("\u001b[2J\u001b]0;title\u0007evil\r\nname\u0000");
    expect(label).toBe("2J-0-title-evil-name");
    expect(label).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("caps a long name at PROJECT_MAX without a hyphen at the cut", () => {
    expect(projectComponent("a".repeat(80))).toBe("a".repeat(PROJECT_MAX));
    // The cut falls on the separator after 31 characters.
    expect(projectComponent(`${"b".repeat(31)} tail`)).toBe("b".repeat(31));
  });

  it("is `project` when nothing printable is left", () => {
    expect(projectComponent("")).toBe("project");
    expect(projectComponent("---")).toBe("project");
    expect(projectComponent("日本語")).toBe("project");
  });
});

describe("worktreeLabel and storeCheckLabel", () => {
  it("names a main worktree's project from its `<project>/.git` common dir", () => {
    const repo = fakeRepo();
    const label = worktreeLabel("daemon", repo.main, resolveCommonDir(repo.main), repo.mainId);
    expect(label).toBe(
      `squeal ${projectComponent(basename(repo.main))} daemon @${repo.mainId.slice(0, 8)}`,
    );
    expect(storeCheckLabel(repo.commonDir as AbsolutePath)).toBe(
      `squeal ${projectComponent(basename(repo.main))} check`,
    );
  });

  it("names a linked worktree by its main checkout's project and its own id", () => {
    const repo = fakeRepo();
    const linked = repo.addWorktree("feature");
    const label = worktreeLabel("node-test", linked.root, resolveCommonDir(linked.root), linked.id);
    expect(label).toBe(
      `squeal ${projectComponent(basename(repo.main))} node-test @${linked.id.slice(0, 8)}`,
    );
    expect(linked.id.slice(0, 8)).not.toBe(repo.mainId.slice(0, 8));
  });

  it("uses the worktree's own name for a separate git dir, and `store` for its check", () => {
    const root = dirNamed("work tree");
    const gitDir = join(tempDir("squeal-label-git-"), "repo.git");
    mkdirSync(gitDir);
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(root, ".git"), `gitdir: ${gitDir}\n`);
    const commonDir = resolveCommonDir(root);
    expect(commonDir).toBe(real(gitDir));
    expect(worktreeLabel("daemon", root, commonDir, null)).toBe("squeal work-tree daemon");
    expect(storeCheckLabel(real(gitDir))).toBe("squeal store check");
  });

  it("uses the worktree's own name for a submodule, whose git dir is under modules/", () => {
    const repo = fakeRepo();
    const modules = join(repo.commonDir, "modules", "lib");
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(modules, "HEAD"), "ref: refs/heads/main\n");
    const sub = join(repo.main, "vendor", "lib");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, ".git"), `gitdir: ${modules}\n`);
    const root = real(sub);
    expect(worktreeLabel("daemon", root, resolveCommonDir(root), null)).toBe("squeal lib daemon");
  });

  it("uses the worktree's own name, made safe, with no common dir", () => {
    const root = dirNamed("evil\u001b[31m name\n");
    expect(worktreeLabel("daemon", root, null, "0123456789abcdef")).toBe(
      "squeal evil-31m-name daemon @01234567",
    );
  });

  it("omits the suffix when the worktree id cannot be read, and still labels", () => {
    const missing = join(tempDir(), "gone") as AbsolutePath;
    expect(displayId(missing)).toBeNull();
    expect(worktreeLabel("daemon", missing, null, displayId(missing))).toBe("squeal gone daemon");
    const repo = fakeRepo();
    expect(displayId(repo.main)).toBe(worktreeIdFor(repo.main));
  });
});

describe("argv0For", () => {
  it("gives the label on Linux only, so other platforms keep the executable as argv0", () => {
    expect(argv0For("squeal p daemon", "linux")).toBe("squeal p daemon");
    expect(argv0For("squeal p daemon", "darwin")).toBeUndefined();
    expect(argv0For("squeal p daemon", "win32")).toBeUndefined();
    expect(argv0For(null, "linux")).toBeUndefined();
  });
});

describe.runIf(process.platform === "linux")("ownNodeArgv0: the node:test leader's guard", () => {
  const repo = () => {
    const r = fakeRepo();
    return {
      root: r.main,
      label: worktreeLabel("node-test", r.main, r.commonDir as AbsolutePath, r.mainId),
    };
  };

  /** A directory holding `node` made by `make`. */
  function binWith(make: (node: string) => void): string {
    const bin = tempDir("squeal-label-bin-");
    make(join(bin, "node"));
    return bin;
  }

  it("labels this process's own Node, by path or as a link on PATH", () => {
    const { root, label } = repo();
    expect(ownNodeArgv0("node-test", root, process.execPath, root, {})).toBe(label);
    const linked = binWith((node) => symlinkSync(process.execPath, node));
    expect(ownNodeArgv0("node-test", root, "node", root, { PATH: linked })).toBe(label);
    // A relative command and a relative PATH entry resolve against the child's cwd.
    expect(ownNodeArgv0("node-test", root, "./node", linked, {})).toBe(label);
    expect(ownNodeArgv0("node-test", root, "node", linked, { PATH: "." })).toBe(label);
  });

  it("keeps argv0 for a shim that is another file, which may pick its tool by argv0", () => {
    const { root } = repo();
    const shim = binWith((node) => {
      writeFileSync(node, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
      chmodSync(node, 0o755);
    });
    expect(ownNodeArgv0("node-test", root, "node", root, { PATH: shim })).toBeUndefined();
    expect(ownNodeArgv0("node-test", root, join(shim, "node"), root, {})).toBeUndefined();
  });

  it("takes the first executable file on PATH, as exec does", () => {
    const { root, label } = repo();
    const plain = binWith((node) => writeFileSync(node, "not executable"));
    const own = binWith((node) => symlinkSync(process.execPath, node));
    const shim = binWith((node) => {
      writeFileSync(node, "#!/bin/sh\n");
      chmodSync(node, 0o755);
    });
    const path = (...dirs: string[]) => ({ PATH: dirs.join(":") });
    expect(ownNodeArgv0("node-test", root, "node", root, path(plain, own))).toBe(label);
    expect(ownNodeArgv0("node-test", root, "node", root, path(shim, own))).toBeUndefined();
  });

  it("keeps argv0 for a command it cannot find or read", () => {
    const { root } = repo();
    const empty = tempDir("squeal-label-empty-");
    expect(ownNodeArgv0("node-test", root, "node", root, { PATH: empty })).toBeUndefined();
    expect(ownNodeArgv0("node-test", root, join(empty, "node"), root, {})).toBeUndefined();
    expect(ownNodeArgv0("node-test", root, "node", root, { PATH: "" })).toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)(
    "keeps argv0, without throwing, when a PATH directory cannot be searched",
    () => {
      const { root } = repo();
      const closed = tempDir("squeal-label-closed-");
      const own = binWith((node) => symlinkSync(process.execPath, node));
      chmodSync(closed, 0o000);
      try {
        expect(
          ownNodeArgv0("node-test", root, "node", root, { PATH: `${closed}/sub:${own}` }),
        ).toBeUndefined();
      } finally {
        // Before the temporary directory's removal, which must read it.
        chmodSync(closed, 0o700);
      }
    },
  );

  it("labels without a project from a root with no git layout", () => {
    const root = dirNamed("plain");
    expect(ownNodeArgv0("node-test", root, process.execPath, root, {})).toBe(
      `squeal plain node-test @${worktreeIdFor(root).slice(0, 8)}`,
    );
  });
});
