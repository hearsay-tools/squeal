// Throwaway probe helpers (spec 022 research, loaded-modules).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";

export const SCRATCH = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const NM = path.join(SCRATCH, "node_modules");

export function load1() {
  return Number(os.loadavg()[0].toFixed(2));
}

export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (content === null) {
      fs.rmSync(p, { force: true, recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (typeof content === "object" && content.symlink) {
      fs.rmSync(p, { force: true, recursive: true });
      fs.symlinkSync(content.symlink, p);
    } else fs.writeFileSync(p, content);
  }
}

/** A fresh fixture dir with node_modules symlinks to the worktree's vitest/vite. */
export function makeFixture(dir, files) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  for (const p of ["vitest", "vite", "@vitest"]) {
    fs.symlinkSync(fs.readlinkSync(path.join(NM, p)), path.join(dir, "node_modules", p));
  }
  fs.copyFileSync(path.join(SCRATCH, "scripts", "lm-recorder.ts"), path.join(dir, "lm-recorder.ts"));
  writeFiles(dir, files);
}

/** One `vitest run` in `dir`; returns per-file status and the recorded sets. */
export function runVitest(dir, tag, { env = {}, args = [] } = {}) {
  const out = path.join(dir, ".lm", tag);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const report = path.join(out, "report.json");
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--reporter=json", `--outputFile=${report}`, ...args],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 120000,
      env: { ...process.env, HOME: path.join(SCRATCH, "home"), CI: "", LM_OUT: out, ...env },
    },
  );
  const wallMs = Date.now() - t0;
  let files = {};
  try {
    const j = JSON.parse(fs.readFileSync(report, "utf8"));
    for (const tr of j.testResults) {
      files[path.relative(dir, tr.name)] = {
        status: tr.status,
        message: (tr.message || tr.assertionResults.flatMap((a) => a.failureMessages).join(" ")).split("\n")[0].slice(0, 200),
      };
    }
  } catch (e) {
    files = { error: (r.stderr || "").slice(-800) };
  }
  const sets = {};
  for (const f of fs.readdirSync(out)) {
    if (f === "report.json") continue;
    const rec = JSON.parse(fs.readFileSync(path.join(out, f), "utf8"));
    const rel = path.relative(dir, rec.filepath);
    const evaluated = rec.mods.filter((m) => m.evaluated && m.file);
    sets[rel] = {
      pid: rec.pid,
      threadId: rec.threadId,
      readMs: rec.readMs,
      // the loaded set: evaluated module files, relative; outside-root kept absolute
      loadedFiles: [...new Set(evaluated.map((m) => rel2(dir, m.file)))].sort(),
      notEvaluated: [...new Set(rec.mods.filter((m) => !m.evaluated && m.file).map((m) => rel2(dir, m.file)))].sort(),
      ids: rec.mods.map((m) => ({ id: rel2(dir, m.id), ev: m.evaluated, ext: m.externalize ? rel2(dir, m.externalize) : undefined, type: m.type })),
    };
  }
  return { files, sets, wallMs, exit: r.status, stderrTail: (r.stderr || "").slice(-600) };
}

function rel2(dir, p) {
  if (typeof p !== "string") return p;
  const clean = p.startsWith("file://") ? new URL(p).pathname : p;
  if (clean.startsWith(dir + "/")) return clean.slice(dir.length + 1);
  if (clean.includes("/node_modules/.pnpm/")) return "<pnpm>/" + clean.split("/node_modules/").slice(-1)[0];
  return clean;
}
