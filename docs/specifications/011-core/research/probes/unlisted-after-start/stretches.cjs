// Throwaway probe (011-385). For Claude Code transcripts (read-only) of Squawk task worktrees,
// prints one JSON line per transcript that has a Squeal text saying the daemon has not listed the
// test files: the first such text (tUnlisted), the first later Squeal text that is not unlisted
// (tListedText), the hooks in between by outcome (timeouts, successes with text, silent
// successes), their durations, and the Bash commands in between that ran tests by hand.
// Usage: node stretches.cjs <since-ISO> <transcript-dir-glob-prefix>...
const fs = require("fs"), path = require("path");
const [since, ...prefixes] = process.argv.slice(2);
// A hand test run: a command segment that starts a test runner (heredoc bodies are skipped).
const RUNNER = /^(npx |pnpm (exec )?|npm exec |yarn )?vitest\b|^(npm|pnpm|yarn) (run )?test(:[\w-]+)?\b|^node( --[\w=.-]+)* --test\b/;
const isHand = (cmd) => cmd.split("\n").filter((l, i, a) => !a.slice(0, i).some((p) => p.includes("<<"))).join("\n")
  .split(/&&|\|\||;|\n|\|/).map((seg) => seg.trim().replace(/^(timeout \d+[smh]? |nice (-n \d+ )?|env |[A-Z_]+=\S* )+/, ""))
  .some((seg) => RUNNER.test(seg));
const root = path.join(process.env.HOME, ".claude/projects");
const dirs = fs.readdirSync(root).filter((d) => prefixes.some((p) => d.startsWith(p)));
for (const d of dirs) {
  for (const f of fs.readdirSync(path.join(root, d))) {
    if (!f.endsWith(".jsonl")) continue;
    const file = path.join(root, d, f);
    if (fs.statSync(file).mtime.toISOString() < since) continue;
    const ev = [];
    let cwd = null;
    const seenBatch = new Set();
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      cwd ??= o.cwd ?? null;
      const a = o.attachment;
      if (a && String(a.type).startsWith("hook_") && a.type !== "hook_additional_context") {
        let text = "";
        if (a.stdout) { try { text = JSON.parse(a.stdout).hookSpecificOutput?.additionalContext ?? ""; } catch {} }
        ev.push({ t: o.timestamp, k: "hook", event: a.hookEvent, type: a.type, ms: a.durationMs ?? null, timedOut: !!a.timedOut,
          squeal: /SQUEAL/.test(text), unlisted: /has not listed this worktree|still starting in this worktree and has no results/.test(text), head: text.split("\n")[0].slice(0, 90) });
      }
      const content = o.message?.content;
      // A tool batch: one assistant message id with tool_use blocks (parallel calls share it).
      if (o.type === "assistant" && Array.isArray(content) && content.some((c) => c.type === "tool_use") && !seenBatch.has(o.message.id)) {
        seenBatch.add(o.message.id); ev.push({ t: o.timestamp, k: "batch" });
      }
      if (o.type === "assistant" && Array.isArray(content)) for (const c of content)
        if (c.type === "tool_use" && c.name === "Bash" && isHand(String(c.input?.command ?? "")))
          ev.push({ t: o.timestamp, k: "hand", cmd: String(c.input.command).slice(0, 120) });
        else if (c.type === "tool_use" && c.name === "Bash" && /\bsqueal (status|run|failures|why)\b/.test(String(c.input?.command ?? "")))
          ev.push({ t: o.timestamp, k: "squealCmd", wait: /--wait/.test(String(c.input.command)) });
    }
    const iu = ev.findIndex((e) => e.k === "hook" && e.unlisted);
    if (iu < 0) continue;
    const il = ev.findIndex((e, i) => i > iu && e.k === "hook" && e.squeal && !e.unlisted);
    const between = ev.slice(iu + 1, il < 0 ? ev.length : il);
    const lastUnlisted = [...ev.slice(iu, il < 0 ? ev.length : il)].reverse().find((e) => e.k === "hook" && e.unlisted);
    const hooks = between.filter((e) => e.k === "hook");
    console.log(JSON.stringify({
      transcript: path.join(d, f), cwd, tUnlisted: ev[iu].t, firstEvent: ev[iu].event, tLastUnlisted: lastUnlisted.t,
      tListedText: il < 0 ? null : ev[il].t, listedEvent: il < 0 ? null : ev[il].event, listedHead: il < 0 ? null : ev[il].head,
      tEnd: ev[ev.length - 1].t,
      timeouts: hooks.filter((e) => e.timedOut).length,
      cancelledOther: hooks.filter((e) => e.type === "hook_cancelled" && !e.timedOut).length,
      successText: hooks.filter((e) => e.type === "hook_success" && e.squeal).length,
      successSilent: hooks.filter((e) => e.type === "hook_success" && !e.squeal).length,
      successMs: hooks.filter((e) => e.type === "hook_success" && e.ms !== null).map((e) => e.ms),
      hand: between.filter((e) => e.k === "hand").length,
      handCmds: between.filter((e) => e.k === "hand").map((e) => e.cmd),
      // PostToolBatch hooks in the hour after the first listed text, for the timeout rate there.
      afterBoundary: il < 0 ? null : ev.slice(il + 1).filter((e) => e.k === "hook" && e.event === "PostToolBatch" && Date.parse(e.t) - Date.parse(ev[il].t) <= 3600e3).length,
      afterTimeouts: il < 0 ? null : ev.slice(il + 1).filter((e) => e.k === "hook" && e.event === "PostToolBatch" && e.timedOut && Date.parse(e.t) - Date.parse(ev[il].t) <= 3600e3).length,
      batchTimes: between.filter((e) => e.k === "batch").map((e) => e.t),
      boundaryTimes: hooks.filter((e) => e.event === "PostToolBatch").map((e) => [e.t, e.timedOut ? 1 : 0]),
      handAfter: ev.slice(il < 0 ? ev.length : il).filter((e) => e.k === "hand").length,
      squealCmds: between.filter((e) => e.k === "squealCmd").length,
      squealCmdsAfter: ev.slice(il < 0 ? ev.length : il).filter((e) => e.k === "squealCmd").length,
      batches: between.filter((e) => e.k === "batch").length,
      batchesAfter: ev.slice(il < 0 ? ev.length : il).filter((e) => e.k === "batch").length,
    }));
  }
}
