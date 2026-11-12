import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import {
  packFiles,
  type TreeWrite,
  treeBlob,
} from "../../../src/core/runner-host/remote/tree-wire.js";

/*
 * Spec 021 D10 (row 021-13): a remote host owns its tree. It writes only
 * inside its root, removes only what it wrote, refuses bytes that do not
 * match their blob id, and installs from the lockfile only when its blob
 * changed since the last install, or that install did.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-tree-host-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function host(env?: NodeJS.ProcessEnv) {
  const root = join(scratch, `t${++n}`, "root");
  mkdirSync(root, { recursive: true });
  const output: string[] = [];
  return { root, output, tree: createTreeHost(root, (text) => output.push(text), env) };
}

/** A file of the tree with its bytes, as `writesFor` reads it. */
const file = (path: string, text: string, mode?: "x" | "link") => ({
  entry: { path, blob: treeBlob(Buffer.from(text)), ...(mode === undefined ? {} : { mode }) },
  bytes: Buffer.from(text),
});

/** One write message of `files`, packed as the daemon sends it, and `removed`. */
const write = async (
  files: readonly ReturnType<typeof file>[],
  removed: readonly string[] = [],
): Promise<TreeWrite> => ({ ...(await packFiles(files)), removed });

describe("a remote host's tree (row 021-13)", () => {
  it("writes files, links and modes, and answers their blob ids", async () => {
    const { root, tree } = host();
    await tree.write(
      await write([
        file("src/a.ts", "a\n"),
        file("bin/run", "#!/bin/sh\n", "x"),
        file("link", "src/a.ts", "link"),
      ]),
    );
    expect(readFileSync(join(root, "src/a.ts"), "utf8")).toBe("a\n");
    expect(statSync(join(root, "bin/run")).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(root, "link"), "utf8")).toBe("a\n");
    expect(await tree.blobs(["src/a.ts", "link", "gone"])).toEqual({
      "src/a.ts": treeBlob(Buffer.from("a\n")),
      link: treeBlob(Buffer.from("src/a.ts")),
      gone: null,
    });
  });

  it("refuses a path that leaves the root, by name or through a link, and bytes that are not their blob", async () => {
    const { root, tree } = host();
    for (const path of ["../out", "/etc/x", "a/../../out", ".git/config", ""]) {
      await expect(tree.write(await write([file(path, "x")]))).rejects.toThrow(/leaves the root/);
    }
    const outside = join(scratch, "outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(root, "escape"));
    await expect(tree.write(await write([file("escape/x", "x")]))).rejects.toThrow(
      /outside the root through a link/,
    );
    expect(existsSync(join(outside, "x"))).toBe(false);
    await expect(
      tree.write(
        await write([
          { ...file("a", "x"), entry: { path: "a", blob: treeBlob(Buffer.from("y")) } },
        ]),
      ),
    ).rejects.toThrow(/do not match their blob id/);
  });

  it("answers what it lacks, and removes only the files it wrote that the tree no longer has", async () => {
    const { root, tree } = host();
    await tree.write(await write([file("keep", "1"), file("old", "2")]));
    // Made on the remote by an install or a run: not the daemon's to remove.
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "node_modules/x.js"), "x");
    const answer = await tree.tree([
      { path: "keep", blob: treeBlob(Buffer.from("1")) },
      { path: "new", blob: treeBlob(Buffer.from("3")) },
      { path: "mode", blob: treeBlob(Buffer.from("4")), mode: "x" },
    ]);
    expect(answer.missing).toEqual(["new", "mode"]);
    expect(existsSync(join(root, "old"))).toBe(false);
    expect(existsSync(join(root, "node_modules/x.js"))).toBe(true);
    await tree.write(await write([], ["node_modules/x.js", "keep"]));
    expect(existsSync(join(root, "node_modules/x.js"))).toBe(true);
    expect(existsSync(join(root, "keep"))).toBe(false);
  });

  it("installs from the lockfile once per lockfile blob", async () => {
    const bin = join(scratch, "fake-npm");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "npm"),
      '#!/bin/sh\necho "npm $*" >> ../installs\nmkdir -p node_modules\necho installed\n',
    );
    chmodSync(join(bin, "npm"), 0o755);
    const { root, tree, output } = host({ ...process.env, PATH: `${bin}:${process.env.PATH}` });
    expect(await tree.install()).toEqual({ ran: false, command: null });
    await tree.write(await write([file("package.json", "{}"), file("package-lock.json", "{}")]));
    expect(await tree.install()).toEqual({ ran: true, command: "npm ci" });
    expect(await tree.install()).toEqual({ ran: false, command: null });
    await tree.write(await write([file("package-lock.json", '{"v":2}')]));
    expect(await tree.install()).toEqual({ ran: true, command: "npm ci" });
    expect(readFileSync(join(root, "../installs"), "utf8")).toBe("npm ci\nnpm ci\n");
    expect(output.join("")).toContain("installed");
  });

  it("installs again from scratch, once, when its install changed since it made it (row 021-24)", async () => {
    const bin = join(scratch, "npm-one-package");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "npm"),
      [
        "#!/bin/sh",
        'echo "npm $*" >> ../installs',
        "mkdir -p node_modules/dep",
        `printf '{"name":"dep","version":"1.0.0"}' > node_modules/dep/package.json`,
        `printf '{"lockfileVersion":3,"packages":{"node_modules/dep":{"version":"1.0.0"}}}' > node_modules/.package-lock.json`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "npm"), 0o755);
    const { root, tree } = host({ ...process.env, PATH: `${bin}:${process.env.PATH}` });
    await tree.write(await write([file("package-lock.json", "{}")]));
    expect(await tree.install()).toEqual({ ran: true, command: "npm ci" });
    // A restore onto a new machine: the folder newer than npm's record of it.
    const later = new Date(Date.now() + 86_400_000);
    utimesSync(join(root, "node_modules/dep"), later, later);
    expect(await tree.install()).toEqual({ ran: true, command: "npm ci", again: true });
    expect(statSync(join(root, "node_modules/dep")).mtimeMs).toBeLessThan(Date.now());
    expect(await tree.install()).toEqual({ ran: false, command: null });
    expect(readFileSync(join(root, "../installs"), "utf8")).toBe("npm ci\nnpm ci\n");
  });

  it("names a failed install with its command and output", async () => {
    const bin = join(scratch, "failing-npm");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 'ENOTFOUND registry' >&2\nexit 3\n");
    chmodSync(join(bin, "npm"), 0o755);
    const { tree } = host({ ...process.env, PATH: `${bin}:${process.env.PATH}` });
    await tree.write(await write([file("package-lock.json", "{}")]));
    await expect(tree.install()).rejects.toThrow(
      /npm ci failed on the remote \(exit code 3\): ENOTFOUND/,
    );
  });
});
