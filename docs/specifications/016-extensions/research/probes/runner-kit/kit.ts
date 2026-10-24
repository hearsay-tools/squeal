/*
 * THROWAWAY probe for research 016-10. Instantiates each scenario of
 * `scenarios.ts` with each pack of `packs.ts` and drives the adapter
 * through `RunnerAdapter` alone: write the fixture, list, run, edit,
 * invalidate, ask `affected` and `closure`, run again. Prints one line per
 * step and a verdict per (scenario, runner). No daemon, no store, no
 * scheduler: transitions are the core's, so the kit checks outcomes.
 *
 *   RUNNER_KIT_PYTHON=<venv> RUNNER_KIT_SCRATCH=<dir> tsx kit.ts [runner...]
 */
import { mkdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RunReport, TestFileRef } from "../../../../../../src/core/types/index.js";
import { type Opened, PACKS, type Pack } from "./packs.js";
import { type Module, type Outcome, SCENARIOS, type Scenario } from "./scenarios.js";

const SCRATCH = process.env.RUNNER_KIT_SCRATCH;
if (SCRATCH === undefined) throw new Error("RUNNER_KIT_SCRATCH names no directory");
const only = process.argv.slice(2);

const isTest = (m: Module) => m.kind === "test" || m.kind === "computed" || m.kind === "broken";

function outcomeOf(report: RunReport, file: TestFileRef, fullName: string): Outcome {
  if (report.fileErrors.some((e) => e.testFile.path === file.path)) return "file-error";
  const result = report.results.find(
    (r) => r.check.testPath === file.path && r.check.fullName === fullName,
  );
  return result?.outcome ?? "absent";
}

async function play(scenario: Scenario, pack: Pack): Promise<boolean> {
  const scratch = join(SCRATCH as string, `${scenario.name}-${pack.name}`);
  rmSync(scratch, { recursive: true, force: true });
  const root = join(scratch, "worktree");
  mkdirSync(join(scratch, "tmp"), { recursive: true });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(pack.project)) write(path, text);
  const modules = new Map(Object.entries(scenario.modules));
  const path = (name: string) => pack.path(name, modules.get(name) as Module);
  for (const [name, module] of modules) write(path(name), pack.text(module));
  const real = realpathSync(root);
  const tests = [...modules].filter(([, m]) => isTest(m)).map(([name]) => name);

  let ok = true;
  const say = (pass: boolean, text: string) => {
    if (!pass) ok = false;
    console.log(`  ${pass ? "ok  " : "FAIL"} ${text}`);
  };
  let opened: Opened | null = null;
  try {
    opened = await pack.open(real, scratch);
    const { adapter } = opened;
    const listed = await adapter.testFiles();
    const ref = (name: string): TestFileRef => {
      const found = listed.find((f) => f.path === path(name));
      if (found === undefined) throw new Error(`${path(name)} is not listed`);
      return found;
    };
    say(
      tests.every((t) => listed.some((f) => f.path === path(t))),
      `lists ${tests.map(path).join(", ")} (got ${listed.map((f) => f.path).join(", ")})`,
    );
    let last: RunReport | null = null;
    for (const [at, step] of scenario.steps.entries()) {
      if ("run" in step) {
        last = await adapter.run(
          tests.map(ref),
          // A fresh directory per run, as the daemon gives (`tiers.ts`): pytest reads its events back
          // from it. RUNNER_KIT_SHARED_LOGS=1 reuses one, to show what that precondition guards.
          {
            runId: `kit-${at}`,
            logDir: join(scratch, "logs", process.env.RUNNER_KIT_SHARED_LOGS === "1" ? "shared" : `kit-${at}`),
            timeoutMs: 120_000,
          },
        );
        if (process.env.RUNNER_KIT_DEBUG !== undefined) {
          console.log(`  debug step ${at} observed ${JSON.stringify(last.observed ?? null)} reads ${JSON.stringify(last.reads ?? null)}`);
        }
        const withheld = (last.withheld ?? []).map((f) => f.path);
        if (withheld.length > 0) console.log(`  note step ${at} withheld ${withheld.join(", ")}`);
        if (last.failure !== null) console.log(`  note step ${at} failure ${last.failure}`);
        for (const [name, expected] of Object.entries(step.expect)) {
          const module = modules.get(name) as Module & { check: string };
          const got = outcomeOf(last, ref(name), pack.fullName(module.check));
          say(got === expected, `step ${at} run (${last.end}): ${name} is ${got}, expected ${expected}`);
          if (got !== expected) {
            const all = last.results.map((r) => `${r.check.testPath}::${r.check.fullName}=${r.outcome}`);
            console.log(`  note step ${at} results ${all.join(" ")}`);
          }
        }
      } else if ("edit" in step) {
        const before = statSync(join(root, path(step.edit)));
        const text = pack.text({ kind: "value", value: step.value });
        if (step.sameStat === true && Buffer.byteLength(text) !== before.size) throw new Error("the edit changes the size");
        write(path(step.edit), text);
        if (step.sameStat === true) utimesSync(join(root, path(step.edit)), before.atime, before.mtime);
        await adapter.invalidate([{ path: path(step.edit), kind: "change" }]);
        const affected = await adapter.affected([path(step.edit)]);
        for (const name of step.reaches) {
          const where = affected.direct.some((f) => f.path === path(name))
            ? "direct"
            : affected.transitive.some((f) => f.path === path(name))
              ? "transitive"
              : null;
          const closure = (await adapter.closure(ref(name))).paths;
          const observed = last === null ? [] : opened.observed(last, ref(name));
          const keyed = closure.includes(path(step.edit)) || observed.includes(path(step.edit));
          say(
            where !== null || keyed,
            `step ${at} edit ${path(step.edit)}: reaches ${name} by affected=${where ?? "none"}, ` +
              `closure=${closure.includes(path(step.edit))}, observed=${observed.includes(path(step.edit))}`,
          );
        }
      } else {
        const closure = (await adapter.closure(ref(step.holds))).paths;
        const observed = last === null ? [] : opened.observed(last, ref(step.holds));
        const target = path(step.module);
        const held = closure.includes(target) || observed.includes(target);
        say(
          held !== (step.lacks === true),
          `step ${at} ${step.holds} ${step.lacks === true ? "lacks" : "holds"} ${target}: closure=${closure.includes(target)}, observed=${observed.includes(target)}`,
        );
      }
    }
  } catch (error) {
    say(false, `threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  } finally {
    await opened?.adapter.close();
  }
  return ok;
}

const verdicts: string[] = [];
for (const scenario of SCENARIOS) {
  for (const pack of PACKS) {
    if (only.length > 0 && !only.includes(pack.name)) continue;
    console.log(`${scenario.name} × ${pack.name}`);
    const ok = await play(scenario, pack);
    const known = pack.known?.[scenario.name];
    const verdict = ok ? (known === undefined ? "PASS" : "UNEXPECTED PASS") : known === undefined ? "FAIL" : "KNOWN";
    verdicts.push(`${verdict} ${scenario.name} × ${pack.name}${known === undefined ? "" : ` (${known})`}`);
  }
}
console.log(verdicts.join("\n"));
process.exitCode = verdicts.every((v) => v.startsWith("PASS") || v.startsWith("KNOWN")) ? 0 : 1;
