// Throwaway (row 018-72): how many of an export's files have a proven key (D11) at its commit.
// Usage: tsx proven.ts <export.json> [project]
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { proven, commitSegments } from "../../../../../../src/core/store/transfer-rekey.ts";
const [file, project = "server"] = process.argv.slice(2);
const e = JSON.parse(readFileSync(file, "utf8"));
const blobs = new Map<string, string>();
for (const line of execFileSync("git", ["-C", `${process.env.HOME}/projects/cezar`, "ls-tree", "-r", e.header.commit], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n")) {
  const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
  if (m) blobs.set(m[2], m[1]);
}
const at = commitSegments(blobs as never);
const env = e.environments.find((x: { project: string }) => x.project === project);
const files = e.testFiles.filter((f: { project: string }) => f.project === project);
console.log(JSON.stringify({ commit: e.header.commit.slice(0, 8), squeal: e.header.squealVersion, files: files.length, proven: files.filter((f: never) => proven(f, env, at)).length, withKeyParts: files.filter((f: { keyParts?: unknown }) => f.keyParts !== undefined).length }));
