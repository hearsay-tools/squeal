#!/usr/bin/env python3
"""Probe 001-343 (throwaway): adds a JSON-lines log ($SQ_PROBE_LOG) to a scratch copy's adapter and SourceStamps.

Usage: python3 -I instrument.py <scratch repo root>. Never applied to a worktree that is committed.
"""
import sys

root = sys.argv[1]
LOG = 'const plog343 = (ev: string, data: Record<string, unknown>) => { const f = process.env.SQ_PROBE_LOG; if (f) appendFileSync(f, `${JSON.stringify({ t: Date.now(), ev, ...data })}\\n`); }; // PROBE-343\n'

def patch(path, edits, header):
    p = f"{root}/{path}"
    s = open(p).read()
    for a, b in edits:
        assert s.count(a) == 1, (path, a)
        s = s.replace(a, b)
    s = header + s
    open(p, "w").write(s)

modState = '''const modStates343 = (vitest: Vitest, suffix: string) => vitest.projects.flatMap((p) => Object.entries(p.vite.environments).flatMap(([name, env]) => [...env.moduleGraph.idToModuleMap].filter(([id]) => id.endsWith(suffix)).map(([, m]) => ({ env: name, cached: m.transformResult != null, inv: typeof m.invalidationState === "string" ? m.invalidationState : m.invalidationState ? "soft" : null, pending: [...((env as unknown as { _pendingRequests: Map<string, unknown> })._pendingRequests?.keys() ?? [])].filter((u) => u.endsWith(suffix)).length })))); // PROBE-343
'''

patch("src/runners/vitest/adapter.ts", [
    ("""      if (this.#running) {
        this.#sources.hold(vitest);""",
     """      plog343("invalidate", { paths: paths.map((p) => `${p.path}:${p.kind}`), running: this.#running, mod: modStates343(vitest, "/src/mod.ts") }); // PROBE-343
      if (this.#running) {
        this.#sources.hold(vitest);"""),
    ("""      const loadedSince = Date.now();
      const started = performance.now();""",
     """      const loadedSince = Date.now();
      plog343("run-start", { files: testFiles.map((f) => f.path), loadedSince }); // PROBE-343
      const started = performance.now();"""),
    ("""        const ran = await this.#invalidateStale(vitest, loadedSince);""",
     """        plog343("run-executed", { mod: modStates343(vitest, "/src/mod.ts") }); // PROBE-343
        const ran = await this.#invalidateStale(vitest, loadedSince);"""),
    ("""        writeRunLog(options, collector, report);
        return report;""",
     """        writeRunLog(options, collector, report);
        plog343("run-end", { loadedSince, ran, heard, completed: report.completedFiles.map((f) => f.path), outcomes: report.results.map((r) => r.outcome), failure: report.failure }); // PROBE-343
        return report;"""),
], 'import { appendFileSync } from "node:fs"; // PROBE-343\n' + LOG + modState)

patch("src/runners/vitest/sources.ts", [
    ("""\n    const read = await readStamp(file);\n""",
     """\n    const read = await readStamp(file);
    if (file.endsWith("/src/mod.ts")) plog343("stamp", { loadedAt, hash: read?.hash.slice(0, 8) ?? null }); // PROBE-343\n"""),
], 'import { appendFileSync } from "node:fs"; // PROBE-343\n' + LOG)
print("instrumented", root)
