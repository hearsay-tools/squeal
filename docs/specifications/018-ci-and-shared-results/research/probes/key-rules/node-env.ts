// Throwaway probe for row 018-15: Squeal 0.1.419's node:test environment for one project under
// two installs of one Node build at different paths. Read only; runs `node -e` only.
// pnpm exec tsx node-env.ts <root> <node A> <node B>
// A node given as "PATH=<dir>" leaves the project's `node` unset (cezar's config) and puts <dir> first on PATH.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { probeNode, projectEnvironment } from "../../../../../../src/runners/node-test/adapter-environment.ts";
import type { AbsolutePath } from "../../../../../../src/core/types/common.ts";

const [root, ...nodes] = process.argv.slice(2) as [AbsolutePath, string, string];
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const out = [];
for (let node of nodes) {
  const dir = node.startsWith("PATH=") ? node.slice(5) : null;
  const project = dir === null
    ? { name: "test:unit", node, argv: [], env: {}, include: ["test/**/*.test.mjs"] }
    : { name: "test:unit", argv: [], env: {}, include: ["test/**/*.test.mjs"] };
  const PATH = process.env.PATH;
  if (dir !== null) process.env.PATH = `${dir}:${PATH}`; // the daemon's PATH, as on another machine
  const probe = await probeNode(project, root);
  process.env.PATH = PATH;
  const env = projectEnvironment(root, project, probe, [], "10");
  if (dir !== null) node = `${dir}/node`;
  const facts = JSON.parse(execFileSync(node, ["-p", "JSON.stringify({versions: process.versions, config: process.config, platform: process.platform, arch: process.arch, release: process.release})"], { encoding: "utf8" }));
  out.push({ node, runnerVersion: env.runnerVersion, resolvedConfig: JSON.parse(env.resolvedConfig),
    versions: sha(JSON.stringify(facts.versions)), config: sha(JSON.stringify(facts.config)),
    platform: facts.platform, arch: facts.arch, release: facts.release.name, openssl: facts.versions.openssl, icu: facts.versions.icu, tz: facts.versions.tz });
}
console.log(JSON.stringify(out, null, 1));
const [a, b] = out.map((o) => o.resolvedConfig);
console.log("config fields that differ:", Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])));
console.log("process.versions equal:", out[0].versions === out[1].versions, "process.config equal:", out[0].config === out[1].config);
