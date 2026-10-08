// Per-file summary of the node:test part of Squeal run logs. Read only.
// Usage: node runlog.mjs <run log dir>...
// For each node-test project under <dir>/node-test/: each file from run.json with its exit,
// whether Squeal counted it completed, the file wrapper's duration (the whole process,
// `test:complete` whose name is the file) and pass/fail/skip counts of its tests.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const dir of process.argv.slice(2)) {
  const base = join(dir, "node-test");
  if (!existsSync(base)) continue;
  for (const project of readdirSync(base)) {
    const pdir = join(base, project);
    const run = JSON.parse(readFileSync(join(pdir, "run.json"), "utf8"));
    console.log(`${dir.split("/").at(-1).slice(0, 8)} [${decodeURIComponent(project)}]`);
    run.files.forEach((f, i) => {
      const ev = join(pdir, `events-${i}.ndjson`);
      const counts = { pass: 0, fail: 0, skip: 0 };
      let wrapper;
      if (existsSync(ev)) {
        for (const line of readFileSync(ev, "utf8").split("\n").filter(Boolean)) {
          const e = JSON.parse(line);
          if (e.type !== "test:pass" && e.type !== "test:fail" && e.type !== "test:complete") continue;
          const isWrapper = f.testFile.endsWith(e.data.name) && e.data.nesting === 0;
          if (e.type === "test:complete" && isWrapper) wrapper = e.data.details?.duration_ms;
          if (e.type === "test:complete" || isWrapper || e.data.details?.type === "suite") continue;
          if (e.data.skip || e.data.todo) counts.skip++;
          else if (e.type === "test:pass") counts.pass++;
          else counts.fail++;
        }
      }
      console.log(
        `  ${f.testFile.split("/").at(-1)} exit=${f.exit?.code ?? f.exit?.signal ?? "-"} completed=${f.completed} ` +
          `${wrapper === undefined ? "no wrapper" : `${(wrapper / 1000).toFixed(1)}s`} pass=${counts.pass} fail=${counts.fail} skip=${counts.skip}`,
      );
    });
  }
}
