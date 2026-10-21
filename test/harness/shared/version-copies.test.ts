import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keepVersion } from "../../../src/harness/shared/version-copies.js";
import { tempDir } from "../../store/helpers.js";

/*
 * Spec 005 D3 as amended 2026-10-21 (row 005-73, `research/plugin-cache-cleanup.md`
 * Recommendation, test 5): Squeal's copies in the plugin data directory, made
 * once per version and pruned by 009-18's rule (`install.sh` `previous` and
 * `in_use`): the newest previous copy and every copy a running process names
 * stay.
 */

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A plugin root of `version`: its CLI, skill and launcher. */
function plugin(version: string, launcher = "#!/bin/sh\n# squeal-launcher format 4\n"): string {
  const root = join(tempDir("squeal-root-"), version);
  write(join(root, "dist", "cli", "squeal.mjs"), `// ${version}\n`);
  write(join(root, "dist", "observe", "recorder.cjs"), `// ${version}\n`);
  write(join(root, "skills", "squeal", "SKILL.md"), `# Squeal ${version}\n`);
  write(join(root, "bin", "squeal-launcher"), launcher);
  chmodSync(join(root, "bin", "squeal-launcher"), 0o755);
  return root;
}

/** A copy as an earlier session start left it. */
function copied(data: string, version: string): string {
  const dir = join(data, "versions", version);
  write(join(dir, "dist", "cli", "squeal.mjs"), `// ${version}\n`);
  return dir;
}

const held: ChildProcess[] = [];
afterEach(() => {
  for (const child of held.splice(0)) child.kill("SIGKILL");
});

/** A running process whose arguments name a file under `dir`, as a daemon spawned from it does. */
async function holding(dir: string): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.stdout.write('up'); setInterval(() => {}, 1000)",
      join(dir, "dist/cli/squeal.mjs"),
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  held.push(child);
  await new Promise((up) => child.stdout?.once("data", up));
}

const versions = (data: string) => readdirSync(join(data, "versions")).sort();

describe("keepVersion", () => {
  it("copies dist/ and skills/ once into versions/<version>/ and writes the launcher", () => {
    const data = join(tempDir("squeal-data-"), "squeal-hearsay");
    const root = plugin("0.1.5");
    const dir = keepVersion({ root, data, version: "0.1.5" });
    expect(dir).toBe(join(data, "versions", "0.1.5"));
    expect(readFileSync(join(data, "versions/0.1.5/dist/cli/squeal.mjs"), "utf8")).toBe(
      "// 0.1.5\n",
    );
    expect(existsSync(join(data, "versions/0.1.5/dist/observe/recorder.cjs"))).toBe(true);
    expect(existsSync(join(data, "versions/0.1.5/skills/squeal/SKILL.md"))).toBe(true);
    expect(existsSync(join(data, "versions/0.1.5/bin"))).toBe(false);
    expect(readFileSync(join(data, "bin", "squeal"), "utf8")).toBe(
      readFileSync(join(root, "bin", "squeal-launcher"), "utf8"),
    );
    expect(statSync(join(data, "bin", "squeal")).mode & 0o777).toBe(0o755);
    // Once: a later start keeps the copy it finds, even when the plugin root changed under it.
    write(join(root, "dist", "cli", "squeal.mjs"), "// rebuilt\n");
    expect(keepVersion({ root, data, version: "0.1.5" })).toBe(dir);
    expect(readFileSync(join(data, "versions/0.1.5/dist/cli/squeal.mjs"), "utf8")).toBe(
      "// 0.1.5\n",
    );
  });

  it("test 5: keeps the newest previous copy and a copy a running process names, and removes the others", async () => {
    const data = tempDir("squeal-data-");
    for (const v of ["0.1.1", "0.1.2", "0.1.3", "0.1.4", "0.1.10"]) copied(data, v);
    // A copy cut short by a killed hook, under a process id that no longer runs.
    write(join(data, "versions", ".0.1.0.2147483646.tmp", "dist", "cli", "squeal.mjs"), "");
    await holding(join(data, "versions", "0.1.2"));
    keepVersion({ root: plugin("0.1.11"), data, version: "0.1.11" });
    expect(versions(data)).toEqual(["0.1.10", "0.1.11", "0.1.2"]);
  });

  it("prunes by version, not by name: 0.1.10 is newer than 0.1.9", () => {
    const data = tempDir("squeal-data-");
    for (const v of ["0.1.9", "0.1.10"]) copied(data, v);
    keepVersion({ root: plugin("0.1.8"), data, version: "0.1.8" });
    expect(versions(data)).toEqual(["0.1.10", "0.1.8"]);
  });

  it("prunes only when it makes a copy", () => {
    const data = tempDir("squeal-data-");
    for (const v of ["0.1.1", "0.1.2", "0.1.3"]) copied(data, v);
    keepVersion({ root: plugin("0.1.3"), data, version: "0.1.3" });
    expect(versions(data)).toEqual(["0.1.1", "0.1.2", "0.1.3"]);
  });

  it("replaces the launcher only from the newest copy, and writes a missing one from any", () => {
    const data = tempDir("squeal-data-");
    keepVersion({ root: plugin("0.1.6", "#!/bin/sh\n# 0.1.6\n"), data, version: "0.1.6" });
    keepVersion({ root: plugin("0.1.5", "#!/bin/sh\n# 0.1.5\n"), data, version: "0.1.5" });
    expect(readFileSync(join(data, "bin", "squeal"), "utf8")).toBe("#!/bin/sh\n# 0.1.6\n");
    keepVersion({ root: plugin("0.1.7", "#!/bin/sh\n# 0.1.7\n"), data, version: "0.1.7" });
    expect(readFileSync(join(data, "bin", "squeal"), "utf8")).toBe("#!/bin/sh\n# 0.1.7\n");
  });

  it("returns null and leaves nothing behind when the data directory cannot be made", () => {
    const blocked = join(tempDir("squeal-data-"), "blocked");
    writeFileSync(blocked, "a file\n");
    expect(keepVersion({ root: plugin("0.1.5"), data: blocked, version: "0.1.5" })).toBeNull();
    expect(readFileSync(blocked, "utf8")).toBe("a file\n");
  });
});
