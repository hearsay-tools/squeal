// Reads trace-vitest.sh's strace.txt and lists every signal sent (not signal 0) that reaches
// the leader's group or a process the trace never saw issue a syscall: kill(0, ...), kill(-leader,
// ...), kill(leader, ...), and kill(±pid, ...) of an unseen pid. Usage: node signals.mjs <strace.txt> <leader pid>
import { readFileSync } from "node:fs";
const [file, leaderText] = process.argv.slice(2);
const leader = Number(leaderText);
const lines = readFileSync(file, "utf8").split("\n");
const seen = new Set(lines.map((l) => Number(l.split(" ")[0])).filter(Boolean));
const re = /^(\d+) (\S+) (kill|tkill|tgkill)\((-?\d+), (?:-?\d+, )?(SIG[A-Z0-9]+)/;
const counts = new Map();
for (const l of lines) {
  const m = re.exec(l);
  if (!m) continue;
  const [, from, at, call, target, sig] = m;
  const t = Number(target);
  const why = t === 0 ? "own group (0)" : t === -leader ? "leader's group" : t === leader ? "leader" : !seen.has(Math.abs(t)) ? (t < 0 ? "unseen group" : "unseen pid") : null;
  const k = `${call} ${why ?? "traced"} ${sig}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
  if (why && (why !== "unseen pid" && why !== "unseen group" || sig === "SIGKILL")) console.log(why.padEnd(16), at, from, `${call}(${target}, ${sig})`, l.slice(l.indexOf("=") ));
}
for (const [k, n] of [...counts].sort()) console.log("count", k, n);
