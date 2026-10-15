// A test process on the current Node (recorder installed, as Squeal would) spawns an older Node.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
const P = process.env.P;
for (const old of process.argv.slice(2)) {
  for (const env of [{ ...process.env }, { PATH: process.env.PATH }]) {
    rmSync(`${P}/fx/out`, { recursive: true, force: true }); mkdirSync(`${P}/fx/out`);
    const r = spawnSync(old, [`${P}/fx/root/child.cjs`], { env, cwd: `${P}/fx/root` });
    const recs = readdirSync(`${P}/fx/out`).map((f) => readFileSync(`${P}/fx/out/${f}`, "utf8")).join("");
    console.log(JSON.stringify({ old: old.split("/").at(-3), env: Object.keys(env).length > 1 ? "inherit" : "{PATH}", parentOptions: process.env.NODE_OPTIONS.slice(0, 9), status: r.status, stderr: String(r.stderr).trim().split("\n").slice(0, 2).join(" | "), recordedData: recs.includes("data.txt") }));
  }
}
