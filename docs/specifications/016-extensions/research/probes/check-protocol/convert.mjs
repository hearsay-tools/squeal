// Throwaway probe (016-03 Q5). Turns one real runner output into Squeal's
// RunReport shape (src/core/types/runner.ts) and lists what the format lacks.
// Usage: node convert.mjs <tap|junit|gojson> <output-file> <project> [<test-file>...]
// The test-file arguments are the files the run was given, as RunOptions would
// name them; the core always knows them.
import { readFileSync } from "node:fs";

const [format, path, project, ...given] = process.argv.slice(2);
const text = readFileSync(path, "utf8");
const missing = new Set();
const results = [];
const fileErrors = [];
const completedFiles = new Set();

function check(testPath, fullName) {
  return { kind: "test", project, testPath, fullName };
}

function err(name, message, location, stack = null, code) {
  return {
    name,
    message,
    stack,
    location,
    diff: null,
    ...(code ? { code } : {}),
  };
}

// "<scratch>/math-cases.mjs:9:12" -> { path, line, column }
function loc(s) {
  const m = /([^\s()'"]+?):(\d+):(\d+)/.exec(s ?? "");
  return m ? { path: m[1].replace(/^file:\/\//, "").replace(/^<scratch>\//, ""), line: +m[2], column: +m[3] } : null;
}

function tap() {
  // Node's TAP: indentation is nesting, "# Subtest: x" opens, the test point closes.
  const lines = text.split("\n");
  const stack = [];
  let last = null;
  let yaml = null;
  for (const line of lines) {
    const indent = line.match(/^ */)[0].length;
    const body = line.slice(indent);
    if (yaml) {
      if (body === "...") {
        last.yaml = yaml;
        yaml = null;
      } else yaml.push(body);
      continue;
    }
    if (body === "---" && last) {
      yaml = [];
      continue;
    }
    const sub = /^# Subtest: (.*)$/.exec(body);
    if (sub) {
      stack.length = indent / 4;
      stack.push(sub[1]);
      continue;
    }
    const point = /^(not )?ok \d+ - (.*?)(?: # (SKIP|TODO).*)?$/.exec(body);
    if (point) {
      stack.length = indent / 4 + 1;
      last = { names: [...stack], ok: !point[1], directive: point[3], yaml: [] };
      results.push(last);
    }
  }
  const out = [];
  for (const r of results.splice(0)) {
    const y = r.yaml.join("\n");
    const type = /type: '(\w+)'/.exec(y)?.[1];
    const location = loc(/location: '([^']+)'/.exec(y)?.[1]);
    if (type === "suite") continue;
    // A test point named after a file is the file-level result Node gives a file that failed to load.
    if (r.names.length === 1 && given.includes(r.names[0])) {
      if (!r.ok) {
        missing.add("file-level error text: TAP point says only 'test failed'; the import error is a '#' comment before it, outside any test point");
        fileErrors.push({ testFile: { project, path: r.names[0] }, errors: [err("Error", "test failed", location, null, /code: '(\w+)'/.exec(y)?.[1])] });
      }
      continue;
    }
    if (!location) missing.add("location of a passing or skipped test: Node's TAP writes it only on failures and suites");
    const file = location?.path ?? null;
    if (!file) missing.add("test file of a passing test: TAP has no file field; nesting starts at the describe, not the file");
    out.push({
      check: check(file ?? "?", r.names.join(" > ")),
      outcome: r.directive ? "skip" : r.ok ? "pass" : "fail",
      durationMs: Number(/duration_ms: ([\d.]+)/.exec(y)?.[1] ?? 0),
      location,
      errors: r.ok
        ? []
        : [err(/name: '(\w+)'/.exec(y)?.[1] ?? "Error", (/error: \|-\n([\s\S]*?)\n\s*code:/.exec(y)?.[1] ?? /error: '([^']*)'/.exec(y)?.[1] ?? "").trim(), loc(/stack: \|-\n\s*(.*)/.exec(y)?.[1]), /stack: \|-\n([\s\S]*)$/.exec(y)?.[1] ?? null, /code: '(\w+)'/.exec(y)?.[1])],
    });
  }
  results.push(...out);
  missing.add("per-file completion: TAP marks the end of a document, not of each file");
}

function junit() {
  const re = /<testcase name="([^"]*)" time="([\d.]+)" classname="([^"]*)" file="([^"]*)"(\/>|[^>]*>([\s\S]*?)<\/testcase>)/g;
  for (const m of text.matchAll(re)) {
    const [, name, time, classname, file, , inner = ""] = m;
    const testPath = file.replace(/^<scratch>\//, "");
    if (classname === "test" && name === testPath) {
      if (/<failure/.test(inner)) {
        missing.add("file-level error text: the import error is not in the XML at all; only 'test failed'");
        fileErrors.push({ testFile: { project, path: testPath }, errors: [err("Error", "test failed", null)] });
      }
      continue;
    }
    const failure = /<failure type="([^"]*)" message="([^"]*)">([\s\S]*?)<\/failure>/.exec(inner);
    missing.add("location of every test: JUnit has file, no line (Node writes no line attribute)");
    missing.add("full name: classname is only the innermost suite; nested describes are lost");
    results.push({
      check: check(testPath, `${classname} > ${name}`),
      outcome: /<skipped/.test(inner) ? "skip" : failure ? "fail" : "pass",
      durationMs: Number(time) * 1000,
      location: null,
      errors: failure ? [err(/cause: (\w+)/.exec(failure[3])?.[1] ?? failure[1], failure[2].replace(/&#10;/g, "\n"), loc(/at [^\n]*?\((file:\/\/[^)]+)\)/.exec(failure[3])?.[1]), failure[3].trim())] : [],
    });
  }
  missing.add("per-file completion: one XML document per run, written at its end");
}

function gojson() {
  const events = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const out = new Map();
  const started = new Set();
  let pkgEnd = null;
  for (const e of events) {
    if (!e.Test) {
      if (e.Action === "pass" || e.Action === "fail" || e.Action === "skip") pkgEnd = e;
      continue;
    }
    const r = out.get(e.Test) ?? { output: [], errors: [] };
    out.set(e.Test, r);
    if (e.Action === "run") started.add(e.Test);
    if (e.Action === "output") {
      r.output.push(e.Output);
      if (e.OutputType === "error" || e.OutputType === "error-continue") r.errors.push(e.Output);
    }
    if (["pass", "fail", "skip"].includes(e.Action)) {
      r.action = e.Action;
      r.elapsed = e.Elapsed;
    }
  }
  const testPath = events.find((e) => e.Package)?.Package ?? given[0];
  if (!events.some((e) => e.Package)) missing.add("Package: absent in this sample (test2json run without -p); go test -json sets it");
  for (const [name, r] of out) {
    if (!r.action) {
      missing.add(`a started test with no end (${name}): the package's fail is the only signal; the reason is in output text`);
      // Read as "completed" with no result, the core would retire the test; a file-level error keeps it failing.
      fileErrors.push({ testFile: { project, path: given[0] }, errors: [err("Error", r.output.filter((o) => !/^(=== |\s*$)/.test(o)).join("").trim(), null, null)] });
      continue;
    }
    const text = (r.errors.length ? r.errors : r.output.filter((o) => !/^(=== |--- |\s*$)/.test(o))).join("");
    const at = /([\w./-]+_test\.go):(\d+)/.exec(text);
    if (r.action === "fail") missing.add("failure location: only as 'file.go:line' inside output text, no column, no structure");
    results.push({
      check: check(testPath, name.replaceAll("/", " > ")),
      outcome: r.action === "fail" ? "fail" : r.action,
      durationMs: (r.elapsed ?? 0) * 1000,
      location: null,
      errors: r.action === "fail" ? [err("Error", text.trim().split("\n")[0] ?? "", at ? { path: at[1], line: +at[2], column: 0 } : null, text)] : [],
    });
  }
  missing.add("location of a test: go test -json has none; go test -list gives top-level names only, no file or line");
  if (pkgEnd) completedFiles.add(testPath);
  return pkgEnd;
}

let end = "completed";
if (format === "tap") tap();
else if (format === "junit") junit();
else if (format === "gojson") {
  const pkgEnd = gojson();
  if (!pkgEnd) end = "crashed";
} else throw new Error(`unknown format ${format}`);

if (format !== "gojson") {
  // Without a per-file end, the only safe reading is that every given file completed when the process exited.
  for (const f of given) completedFiles.add(f);
}

for (const m of [
  "closure (RunnerClosure.paths, packages): no format carries the inputs a file read",
  "environment (RunnerEnvironment): runner and adapter version, resolved config, environment files",
  "withheld / observed / reads: no format can say a result is untrustworthy because inputs moved",
  "focused counts (collected, matched): no format reports how many checks a filter selected",
  "startupFailure vs fileErrors: no format separates a global setup failure from a file's load failure",
  "duplicate full names: neither id nor line tells the two 'adds' tests apart in TAP or JUnit",
]) {
  missing.add(m);
}

const report = {
  end,
  durationMs: null,
  completedFiles: [...completedFiles].map((p) => ({ project, path: p })),
  results,
  fileErrors,
  failure: end === "completed" ? null : "the package-level event or a test's end is absent",
};
console.log(JSON.stringify({ report, missing: [...missing] }, null, 2));
