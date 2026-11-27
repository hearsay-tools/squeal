import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  type SetupPlace,
  setupRefusal,
} from "../../../src/core/runner-host/remote/remote-setup.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";

/*
 * Spec 026 D13.1 (row 026-35): the host's side of `remote.setup`. The script
 * runs in the tree's root unless a mark for its content is in the machine's
 * marks; exit code 0 leaves the mark, so it does not run again until its
 * content changes; a failure leaves none and answers its exit code and the
 * end of its output.
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

describe("remote.setup on the host (row 026-35, D13.1)", () => {
  it("runs once in the tree's root, marks its content, and runs again only after an edit", async () => {
    const { cache, root, runs, script, count } = machine();
    script("echo ready");
    const host = createTreeHost(root, () => {});
    const first = await host.setup(".squeal/remote-setup.sh");
    expect(first).toMatchObject({ ran: true, output: "ready\n" });
    expect(first.failed).toBeUndefined();
    expect(readFileSync(runs, "utf8").trim()).toBe(root);
    // The mark is the machine's, under the remote cache, named by the content's SHA-256.
    expect(existsSync(join(cache, "squeal/setup", first.sha256 ?? ""))).toBe(true);

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
    expect(count()).toBe(2);
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
    expect(existsSync(join(cache, "squeal/setup", failed.sha256 ?? ""))).toBe(false);
    expect(setupRefusal(".squeal/remote-setup.sh", "build-box", failed)).toBe(
      "remote.setup .squeal/remote-setup.sh failed on build-box (exit code 3): installing chrome | apt-get: permission denied",
    );
    expect((await runSetup(place)).ran).toBe(true);
    expect(count()).toBe(2);
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
