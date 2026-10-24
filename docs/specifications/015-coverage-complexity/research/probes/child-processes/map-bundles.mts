// Throwaway probe (015 R3). Rebuilds each plugin's bundles with the shipped
// options plus `sourcemap: "external"` (no comment in the .mjs), into
// <out>/<plugin>/, and checks each .mjs is byte-identical to the committed one,
// so a child's raw V8 coverage of a committed bundle can be mapped to src/.
// Run from the scratch repo: npx tsx <this> <out>
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { bundleOptions, REPO_ROOT } from "../src/harness/build.ts";
import { CLAUDE_CODE_PLUGIN } from "../src/harness/claude-code/build.ts";
import { CODEX_PLUGIN } from "../src/harness/codex/build.ts";
import { OPENCODE_PLUGIN } from "../src/harness/opencode/build.ts";
import { PI_PLUGIN } from "../src/harness/pi/build.ts";

const out = process.argv[2];
const plugins = { "claude-code": CLAUDE_CODE_PLUGIN, codex: CODEX_PLUGIN, opencode: OPENCODE_PLUGIN, pi: PI_PLUGIN };
for (const [name, plugin] of Object.entries(plugins)) {
  const dir = join(out, name);
  const { metafile } = await build({ ...bundleOptions(plugin, dir), sourcemap: "external" });
  for (const file of Object.keys(metafile.outputs).filter((f) => f.endsWith(".mjs"))) {
    const rel = file.slice(file.indexOf(`${name}/`) + name.length + 1);
    const committed = join(REPO_ROOT, "plugins", name, "dist", rel);
    const same = existsSync(committed) && readFileSync(committed, "utf8") === readFileSync(join(REPO_ROOT, file.startsWith("/") ? "" : "", file), "utf8");
    console.log(`${name}/${rel}\t${same ? "identical" : "DIFFERS"}`);
  }
}
