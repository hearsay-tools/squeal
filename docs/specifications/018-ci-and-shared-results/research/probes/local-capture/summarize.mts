// throwaway (row 018-22): summary of manual-runs.mjs output, plus whether Squeal's own
// recognizer (src/harness/shared/test-command.ts, spec 005 D8) would recognize each command.
// Run with the worktree's tsx: node_modules/.bin/tsx summarize.mts <runs.json> <worktree>
import fs from "node:fs";
const [file, wt] = process.argv.slice(2);
const { recognizeTestCommand } = await import(`${wt}/src/harness/shared/test-command.ts`);
const { runs, sessions, from, to } = JSON.parse(fs.readFileSync(file, "utf8"));
const { commandContext } = await import(`${wt}/src/runners/descriptions.ts`);
const { readPolicy } = await import(`${wt}/src/core/daemon/policy.ts`);
// The context a hook builds for a command run at the root (deny.ts testCommandOf), read now.
const roots: Record<string, string> = { squeal: wt, cezar: "/home/agent/projects/cezar" };
const contexts: Record<string, unknown> = {};
for (const [repo, root] of Object.entries(roots)) contexts[repo] = commandContext(readPolicy(root), root, root);
const ctx = (repo: string) => contexts[repo] as never;
const days = (Date.parse(to) - Date.parse(from)) / 864e5;
const sum = (xs: any[], f: (x: any) => number | null) => xs.reduce((a, x) => a + (f(x) ?? 0), 0);
const out: string[] = [`window ${from} to ${to} (${days} days)`];
for (const repo of ["squeal", "cezar"]) {
  const rs = runs.filter((r: any) => r.repo === repo);
  const ss = sessions.filter((s: any) => s.repo === repo);
  const withRuns = ss.filter((s: any) => s.runs > 0).length;
  const parsed = rs.filter((r: any) => r.vitestParts != null && r.vitestWall > 0);
  const ratio = sum(parsed, (r) => r.vitestParts) / sum(parsed, (r) => r.vitestWall);
  const wall = sum(rs, (r) => r.wallS);
  const est = sum(rs, (r) => (r.vitestParts != null ? r.vitestParts : r.runner === "node:test" ? r.wallS : (r.wallS ?? 0) * ratio));
  const recognized = rs.filter((r: any) => recognizeTestCommand(r.cmd, ctx(repo)) !== null);
  const recognizedSeg = rs.filter((r: any) => recognizeTestCommand(r.segment.replace(/\s+\d?>&\d\s*$/, "").replace(/^timeout\s+\d+\s+/, ""), ctx(repo)) !== null);
  const by = (f: (r: any) => string) => { const m: Record<string, number> = {}; for (const r of rs) m[f(r)] = (m[f(r)] ?? 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; "); };
  const plain = rs.filter((r: any) => !r.namePattern && !r.update && !r.lineFilter && !r.coverage && !r.elsewhere && r.runner !== "node:test");
  out.push(`\n## ${repo}`,
    `sessions with a shell command: ${ss.length} (${by.call(null, () => "") && ss.filter((s: any) => s.harness === "claude-code").length} Claude Code, ${ss.filter((s: any) => s.harness === "codex").length} Codex); with a test run: ${withRuns}`,
    `runs: ${rs.length} (${(rs.length / days).toFixed(0)} a day); by harness: ${by((r) => r.harness)}; subagent files: ${rs.filter((r: any) => r.subagent).length}`,
    `by runner and scope: ${by((r) => `${r.runner} ${r.scope}`)}`,
    `by form: ${by((r) => r.form)}`,
    `traits: pipe/chain/redirect ${rs.filter((r: any) => r.pipeOrChain).length}; name pattern ${rs.filter((r: any) => r.namePattern).length}; --update ${rs.filter((r: any) => r.update).length}; line filter ${rs.filter((r: any) => r.lineFilter).length}; --coverage ${rs.filter((r: any) => r.coverage).length}; another directory ${rs.filter((r: any) => r.elsewhere).length}; watch-form ${rs.filter((r: any) => r.watch).length}`,
    `outcome read: pass ${rs.filter((r: any) => r.outcome === "pass").length}, fail ${rs.filter((r: any) => r.outcome === "fail").length}, unknown ${rs.filter((r: any) => r.outcome == null).length}`,
    `wall s: ${wall.toFixed(0)} (${(wall / days / 60).toFixed(1)} min a day); Vitest summary parsed in ${parsed.length} runs, summed worker parts / wall = ${ratio.toFixed(2)}`,
    `estimated test seconds (parts where parsed, node:test wall, else wall x ratio): ${est.toFixed(0)} (${(est / days).toFixed(0)} a day)`,
    `recognized by Squeal's deny recognizer, whole command: ${recognized.length}; the test segment alone (timeout and 2>&1 removed): ${recognizedSeg.length}`,
    `plain Vitest runs (no name pattern, update, line filter, coverage or other directory): ${plain.length}; of them with a pipe/chain/redirect ${plain.filter((r: any) => r.pipeOrChain).length}`,
    `other flags seen: ${(() => { const m: Record<string, number> = {}; for (const r of rs) for (const f of r.otherFlags) m[f] = (m[f] ?? 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${v}`).join(", "); })()}`,
  );
}
console.log(out.join("\n"));
