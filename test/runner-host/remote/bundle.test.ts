import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  bundleDir,
  CHECK_SCRIPT,
  ensureBundle,
  readBundle,
} from "../../../src/core/runner-host/remote/bundle.js";
import { shellQuote } from "../../../src/core/runner-host/remote/ssh.js";
import { tarOf } from "../../../src/core/runner-host/remote/tar.js";
import { fakeSsh } from "./helpers.js";

/*
 * Spec 021 D14 (row 021-13): the bundle is copied once per version as a tar
 * on ssh's input, and checked on the remote by a script whose checksum is
 * the daemon's own.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-bundle-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A small dist: a CLI, a runtime file, and a hook bundle at the top that is not copied. */
function dist(name: string): string {
  const root = join(scratch, name);
  mkdirSync(join(root, "cli"), { recursive: true });
  mkdirSync(join(root, "observe/deep"), { recursive: true });
  writeFileSync(join(root, "cli/squeal.mjs"), "console.log('squeal');\n");
  writeFileSync(join(root, "observe/deep/recorder.cjs"), Buffer.alloc(700, 1));
  writeFileSync(join(root, "session-start.mjs"), "hook\n");
  return root;
}

describe("the bundle a remote gets (row 021-13)", () => {
  it("is a ustar archive tar unpacks byte for byte, long paths included", () => {
    const long = `${"a".repeat(80)}/${"b".repeat(90)}.txt`;
    const files = [
      { path: "cli/squeal.mjs", bytes: Buffer.from("x".repeat(513)) },
      { path: long, bytes: Buffer.from("deep\n") },
      { path: "empty", bytes: Buffer.alloc(0) },
    ];
    const out = join(scratch, "untar");
    mkdirSync(out);
    execFileSync("tar", ["-xf", "-", "-C", out], { input: tarOf(files) });
    for (const file of files) expect(readFileSync(join(out, file.path))).toEqual(file.bytes);
  });

  it("holds the CLI's directories, not the hook bundles, and a checksum the remote script agrees with", () => {
    const root = dist("agree");
    const bundle = readBundle(join(root, "cli/squeal.mjs"));
    expect(bundle?.files).toEqual(["cli/squeal.mjs", "observe/deep/recorder.cjs"]);
    expect(bundle?.cli).toBe("cli/squeal.mjs");
    const check = (dir: string) =>
      JSON.parse(
        execFileSync(process.execPath, ["-e", CHECK_SCRIPT, "check", dir, bundle?.checksum ?? ""], {
          encoding: "utf8",
        }),
      ).bundle;
    // The script walks a copied directory: only the bundle's files, so a copy of them.
    const copy = join(scratch, "agree-copy");
    for (const file of bundle?.files ?? []) {
      mkdirSync(join(copy, file, ".."), { recursive: true });
      writeFileSync(join(copy, file), readFileSync(join(root, file)));
    }
    expect(check(copy)).toBe("present");
    writeFileSync(join(copy, "observe/deep/recorder.cjs"), "changed");
    expect(check(copy)).toBe("differs");
    expect(check(join(scratch, "nowhere"))).toBe("absent");
  });

  it("is none for a daemon from the sources", () => {
    expect(readBundle("/repo/src/cli/index.ts")).toBeNull();
  });

  it("is copied when absent or different, and used as it is when whole", async () => {
    const root = dist("ensure");
    const bundle = readBundle(join(root, "cli/squeal.mjs"));
    if (bundle === null) throw new Error("no bundle");
    const home = join(scratch, "home");
    const target = { destination: "box", ssh: fakeSsh(join(scratch, "bin"), home) };
    const places = { node: process.execPath, cache: ".cache" };
    const options = { target, places, version: "9.9.9", bundle, deadlineMs: 30_000 };

    const first = await ensureBundle(options);
    expect(first).toMatchObject({
      copied: true,
      check: { bundle: "absent", node: expect.stringMatching(/^v\d+\./) },
    });
    const copied = join(home, bundleDir(places, "9.9.9"));
    expect(readFileSync(join(copied, "cli/squeal.mjs"), "utf8")).toContain("squeal");

    expect(await ensureBundle(options)).toMatchObject({ copied: false });

    writeFileSync(join(copied, "cli/squeal.mjs"), "broken");
    expect(await ensureBundle(options)).toMatchObject({
      copied: true,
      check: { bundle: "differs" },
    });
    expect(readFileSync(join(copied, "cli/squeal.mjs"), "utf8")).toContain("squeal");
  });

  it("names the step that failed: no Node on the remote", async () => {
    const root = dist("no-node");
    const bundle = readBundle(join(root, "cli/squeal.mjs"));
    if (bundle === null) throw new Error("no bundle");
    const target = { destination: "box", ssh: fakeSsh(join(scratch, "bin2"), join(scratch, "h2")) };
    await expect(
      ensureBundle({
        target,
        places: { node: "/no/such/node", cache: ".cache" },
        version: "9.9.9",
        bundle,
        deadlineMs: 30_000,
      }),
    ).rejects.toThrow(/could not check Squeal on box: .*no\/such\/node/);
  });

  it("quotes a word for the remote shell only when it must", () => {
    expect(shellQuote(".cache/squeal/0.1.1")).toBe(".cache/squeal/0.1.1");
    expect(shellQuote("it's here")).toBe(`'it'\\''s here'`);
    expect(
      execFileSync("sh", ["-c", `printf %s ${shellQuote("a b'c$HOME")}`], { encoding: "utf8" }),
    ).toBe("a b'c$HOME");
  });
});
