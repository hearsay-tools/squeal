// Prints the fields of a `status --json --wait <ms> <path>...` payload that #59 is about.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let j;
  try { j = JSON.parse(raw); } catch { console.log("not JSON:", raw.slice(0, 400)); return; }
  const w = j.wait;
  if (w === undefined) { console.log("no wait field; keys:", Object.keys(j).join(",")); return; }
  console.log(JSON.stringify({
    outcome: w.outcome, waitedMs: w.waitedMs, code: w.code, unmatched: w.unmatched,
    testFiles: w.testFiles.map((f) => `${f.path ?? f.testFile?.path}:${f.class ?? f.phase ?? f.state}`),
    byClass: w.verdict.byClass, revision: w.verdict.revision, unlisted: w.verdict.unlisted,
  }));
});
