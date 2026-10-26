// Throwaway probe (016-33). Reads the recorded tool output of run.sh and
// applies each candidate check unit to the state sequence s0..s7. Prints, per
// tool, candidate and edit, the notices an agent would get and whether each
// one is true against the experimenter's labels (enclosing function + kind).
// Usage: node compare.mjs <states-dir> <out-dir>
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const [statesDir, outDir] = process.argv.slice(2);
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

function parse(tool, state) {
  if (tool === "ts") {
    return readFileSync(join(outDir, "ts", `${state}.txt`), "utf8").split("\n").flatMap((l) => {
      const m = /^(\S+)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(l);
      return m ? [{ file: m[1], line: +m[2], col: +m[3], rule: m[4], message: m[5] }] : [];
    });
  }
  if (tool === "js") {
    return JSON.parse(readFileSync(join(outDir, "js", `${state}.json`), "utf8")).flatMap((f) =>
      f.messages.map((m) => ({ file: basename(f.filePath), line: m.line, col: m.column, rule: m.ruleId, message: m.message })),
    );
  }
  const gitlab = JSON.parse(readFileSync(join(outDir, "py", `${state}.gitlab`), "utf8"));
  return JSON.parse(readFileSync(join(outDir, "py", `${state}.json`), "utf8")).map((m, i) => ({
    file: basename(m.filename), line: m.location.row, col: m.location.column, rule: m.code, message: m.message,
    toolFingerprint: gitlab[i].fingerprint, // same order and count; checked below
    gitlabLine: gitlab[i].location.positions.begin.line,
  }));
}

function enrich(tool, state, findings) {
  const seen = new Map();
  return findings.map((f) => {
    const src = readFileSync(join(statesDir, tool, state, f.file), "utf8").split("\n");
    if (f.gitlabLine !== undefined && f.gitlabLine !== f.line) throw new Error(`gitlab order differs at ${state}`);
    let fn = "module";
    for (let i = f.line - 1; i >= 0; i--) {
      const m = /(?:function|def) (\w+)/.exec(src[i]);
      if (m) { fn = m[1]; break; }
    }
    const kind = /never|unused/i.test(f.message) ? "unused" : /report/.test(f.message) ? "report" : /notify/.test(f.message) ? "notify" : "type";
    // Candidate (b): rule, message, the line's text without whitespace, occurrence index; no line number.
    const base = `${f.file}|${f.rule}|${f.message}|${sha(src[f.line - 1].replace(/\s+/g, ""))}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...f, truth: `${fn}:${kind}`, anchor: `${base}#${n}`, loc: `${f.file}:${f.line}:${f.col}` };
  });
}

// A candidate maps the findings of one state to { checkId -> { truths, fp } }.
const candidates = {
  "a-loc file check, C5 fingerprint (first finding with line)": (fs) => perFile(fs, (g) => `${g[0].rule}: ${g[0].message} @ ${g[0].loc}`),
  "a-set file check, fingerprint = multiset of rule+message": (fs) => perFile(fs, (g) => g.map((f) => `${f.rule}|${f.message}`).sort().join(";")),
  "b finding check, content anchor, line in fingerprint": (fs) => perKey(fs, (f) => f.anchor, (f) => f.loc),
  "b finding check, content anchor, no line in fingerprint": (fs) => perKey(fs, (f) => f.anchor, () => ""),
  "c finding check, tool fingerprint (Ruff gitlab only), no line in fingerprint": (fs) => (fs.every((f) => f.toolFingerprint) ? perKey(fs, (f) => `${f.file}|${f.toolFingerprint}`, () => "") : null),
};
function perFile(fs, fp) {
  const out = {};
  for (const file of ["a", "b"]) {
    const g = fs.filter((f) => f.file.startsWith(`${file}.`)).sort((x, y) => x.line - y.line);
    out[file] = { truths: g.map((f) => f.truth), fp: g.length ? fp(g) : null };
  }
  return out;
}
function perKey(fs, id, fp) {
  const out = {};
  for (const f of fs) {
    if (out[id(f)]) throw new Error(`duplicate id ${id(f)}`);
    out[id(f)] = { truths: [f.truth], fp: fp(f) };
  }
  return out;
}

const states = readdirSync(join(statesDir, "ts")).sort();
for (const tool of ["ts", "js", "py"]) {
  const per = states.map((s) => enrich(tool, s, parse(tool, s)));
  console.log(`\n## ${tool}`);
  per.forEach((fs, i) => console.log(`${states[i]}: ${fs.map((f) => `${f.truth}@${f.loc}${f.toolFingerprint ? `[${f.toolFingerprint}]` : ""}`).join("  ")}`));
  for (const [name, cand] of Object.entries(candidates)) {
    const views = per.map(cand);
    if (views[0] === null) { console.log(`\n### ${name}: not available (the tool writes no fingerprint)`); continue; }
    console.log(`\n### ${name}`);
    for (let i = 1; i < states.length; i++) {
      const before = views[i - 1], after = views[i];
      const tBefore = per[i - 1].map((f) => f.truth), tAfter = per[i].map((f) => f.truth);
      const notices = [];
      for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const b = before[id], a = after[id];
        const was = b && b.fp !== null, is = a && a.fp !== null;
        const short = id.length > 30 ? `${id.split("|")[0]}|${id.split("|")[1]}|…#${id.split("#")[1] ?? ""}` : id;
        if (!was && is) {
          const already = a.truths.filter((t) => tBefore.includes(t));
          notices.push(`${short} FAIL (new) ${already.length === a.truths.length ? "FALSE: already failing" : "true"}`);
        } else if (was && !is) {
          const still = b.truths.filter((t) => tAfter.includes(t));
          notices.push(`${short} FAIL->PASS ${still.length ? `FALSE: ${still.join(",")} still failing` : "true"}`);
        } else if (was && is && a.fp !== b.fp) {
          notices.push(`${short} FAIL->FAIL changed [${b.truths.join(",")}] -> [${a.truths.join(",")}]`);
        }
      }
      const newTruths = tAfter.filter((t) => !tBefore.includes(t)), goneTruths = tBefore.filter((t) => !tAfter.includes(t));
      console.log(`- ${states[i]}: ${notices.length} notice(s)${notices.length ? `: ${notices.join("; ")}` : ""} | truth: new [${newTruths}] fixed [${goneTruths}]`);
    }
  }
}
