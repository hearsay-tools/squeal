import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  lastLines,
  runSetup,
  SETUP_MARK,
  type SetupPlace,
  setupRefusal,
} from "../../../src/core/runner-host/remote/remote-setup.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";

/*
 * Spec 026 D13.1 (row 026-35): the host's side of `remote.setup`. The script
 * runs in the tree's root unless the machine's one mark holds its content;
 * exit code 0 replaces the mark, so it does not run again until another
 * content ran or its own changed (review 0.1.656 B2: a revert runs again);
 * a failure leaves the mark as it was and answers its exit code and the end
 * of its output.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A machine: `<cache>/squeal/trees/<key>/root` and the count file the script appends to. */
function machine() {
  const cache = mkdtempSync(join(tmpdir(), "squeal-remote-setup-"));
  dirs.push(cache);
  const root = join(cache, "squeal/trees/0123456789abcdef/root");
  mkdirSync(root, { recursive: true });
  const runs = join(cache, "runs.txt");
  const script = (body: string) => {
    mkdirSync(join(root, ".squeal"), { recursive: true });
    const at = join(root, ".squeal/remote-setup.sh");
    writeFileSync(at, `#!/bin/sh\necho "$(pwd)" >> ${JSON.stringify(runs)}\n${body}\n`);
    chmodSync(at, 0o755);
  };
  const count = () => (existsSync(runs) ? readFileSync(runs, "utf8").trim().split("\n").length : 0);
  return { cache, root, runs, script, count };
}

const serial: SetupPlace["locked"] = (_lock, work) => work();

/** The SHA-256 the machine's mark holds; `null` when there is none. */
function markOf(cache: string): string | null {
  const mark = join(cache, "squeal/setup", SETUP_MARK);
  return existsSync(mark) ? (readFileSync(mark, "utf8").split("\n")[0] ?? null) : null;
}

describe("remote.setup on the host (row 026-35, D13.1)", () => {
  it("runs once in the tree's root, marks its content, and runs again only after an edit", async () => {
    const { cache, root, runs, script, count } = machine();
    script("echo ready");
    const host = createTreeHost(root, () => {});
    const first = await host.setup(".squeal/remote-setup.sh");
    expect(first).toMatchObject({ ran: true, output: "ready\n" });
    expect(first.failed).toBeUndefined();
    expect(readFileSync(runs, "utf8").trim()).toBe(root);
    // The mark is the machine's, under the remote cache, and holds the content's SHA-256.
    expect(markOf(cache)).toBe(first.sha256);

    expect(await host.setup(".squeal/remote-setup.sh")).toEqual({
      ran: false,
      sha256: first.sha256,
      output: "",
    });
    // Another worktree's tree on the same machine finds the same mark.
    const other = join(cache, "squeal/trees/fedcba9876543210/root");
    mkdirSync(join(other, ".squeal"), { recursive: true });
    writeFileSync(
      join(other, ".squeal/remote-setup.sh"),
      readFileSync(join(root, ".squeal/remote-setup.sh")),
    );
    chmodSync(join(other, ".squeal/remote-setup.sh"), 0o755);
    expect((await createTreeHost(other, () => {}).setup(".squeal/remote-setup.sh")).ran).toBe(
      false,
    );
    expect(count()).toBe(1);

    script("echo ready again");
    const edited = await host.setup(".squeal/remote-setup.sh");
    expect(edited).toMatchObject({ ran: true, output: "ready again\n" });
    expect(edited.sha256).not.toBe(first.sha256);
    expect(markOf(cache)).toBe(edited.sha256);
    expect(count()).toBe(2);
  });

  it("runs a reverted script again: the mark holds the last content that ran (review 0.1.656 B2)", async () => {
    const { cache, root, script } = machine();
    const state = join(cache, "state.txt");
    const host = createTreeHost(root, () => {});
    const ran: boolean[] = [];
    for (const content of ["A", "B", "A"]) {
      script(`echo ${content} > ${JSON.stringify(state)}`);
      ran.push((await host.setup(".squeal/remote-setup.sh")).ran);
      expect(readFileSync(state, "utf8").trim()).toBe(content);
    }
    expect(ran).toEqual([true, true, true]);
    // One mark per machine, replaced each time; no mark per content.
    expect(readdirSync(join(cache, "squeal/setup"))).toEqual([SETUP_MARK]);
  });

  it("shares the mark between two worktrees of equal content, and runs again after another content", async () => {
    const { cache, root, script, count } = machine();
    script("echo one");
    const other = join(cache, "squeal/trees/fedcba9876543210/root");
    const copy = (body: string) => {
      mkdirSync(join(other, ".squeal"), { recursive: true });
      const at = join(other, ".squeal/remote-setup.sh");
      writeFileSync(
        at,
        `#!/bin/sh
echo "$(pwd)" >> ${JSON.stringify(join(cache, "runs.txt"))}
${body}
`,
      );
      chmodSync(at, 0o755);
    };
    const mine = createTreeHost(root, () => {});
    const theirs = createTreeHost(other, () => {});
    copy("echo one");
    expect((await mine.setup(".squeal/remote-setup.sh")).ran).toBe(true);
    expect((await theirs.setup(".squeal/remote-setup.sh")).ran).toBe(false);
    copy("echo two");
    expect((await theirs.setup(".squeal/remote-setup.sh")).ran).toBe(true);
    // The machine was last set up by the other content: this one runs again.
    expect((await mine.setup(".squeal/remote-setup.sh")).ran).toBe(true);
    expect(count()).toBe(3);
  });

  it("answers a failure with its exit code and output, leaves no mark, and runs again next time", async () => {
    const { cache, root, script, count } = machine();
    script('echo "installing chrome"\necho "apt-get: permission denied" >&2\nexit 3');
    const place: SetupPlace = {
      root,
      path: ".squeal/remote-setup.sh",
      marks: join(cache, "squeal/setup"),
      env: process.env,
      locked: serial,
    };
    const failed = await runSetup(place);
    expect(failed).toMatchObject({
      ran: true,
      failed: "exit code 3",
      output: "installing chrome\napt-get: permission denied\n",
    });
    expect(markOf(cache)).toBeNull();
    expect(setupRefusal(".squeal/remote-setup.sh", "build-box", failed)).toBe(
      "remote.setup .squeal/remote-setup.sh failed on build-box (exit code 3): installing chrome | apt-get: permission denied",
    );
    expect((await runSetup(place)).ran).toBe(true);
    expect(count()).toBe(2);
    // A failure after a success leaves the success's mark.
    script("echo fixed");
    const fixed = await runSetup(place);
    script("exit 4");
    expect((await runSetup(place)).failed).toBe("exit code 4");
    expect(markOf(cache)).toBe(fixed.sha256);
  });

  it("answers a missing script, one that leaves the tree, one not executable, and one past its bound", async () => {
    const { cache, root, script } = machine();
    const place = (path: string, timeoutMs?: number): SetupPlace => ({
      root,
      path,
      marks: join(cache, "squeal/setup"),
      env: process.env,
      locked: serial,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    expect(await runSetup(place(".squeal/none.sh"))).toEqual({
      ran: false,
      sha256: null,
      failed: "no such file in the tree",
      output: "",
    });
    expect((await runSetup(place("../outside.sh"))).failed).toBe("a path that leaves the tree");
    writeFileSync(join(root, "plain.sh"), "#!/bin/sh\necho hi\n");
    expect((await runSetup(place("plain.sh"))).failed).toMatch(/^could not start: .*EACCES/);
    script("echo started\nsleep 5");
    const slow = await runSetup(place(".squeal/remote-setup.sh", 200));
    expect(slow).toMatchObject({ ran: true, failed: "timed out after 0.2 s", output: "started\n" });
  });

  it("keeps the last lines of a long output for status", () => {
    const output = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(lastLines(`${output}\n\n`)).toBe("line 5 | line 6 | line 7 | line 8 | line 9");
    expect(
      setupRefusal("s.sh", "box", {
        ran: true,
        sha256: null,
        failed: "signal SIGKILL",
        output: "",
      }),
    ).toBe("remote.setup s.sh failed on box (signal SIGKILL)");
  });
});
