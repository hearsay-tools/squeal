// 011-223 probe: copy of a shipped squeal.mjs that appends one line per start step to a log file.
// Line: <pid> <epoch ms> <s since process start> <step>. Each anchor must occur exactly once.
// usage: node patch.mjs <squeal.mjs in> <squeal.mjs out> <log file>
import { readFileSync, writeFileSync } from "node:fs";
const [input, output, log] = process.argv.slice(2);
let text = readFileSync(input, "utf8");
const T = (label) => `__fscT(${JSON.stringify(label)});`;
const edits = [
  ["const require = __squealCreateRequire(import.meta.url);\n",
    `const require = __squealCreateRequire(import.meta.url);\nconst __fscT = (l) => { try { require("node:fs").appendFileSync(${JSON.stringify(log)}, \`\${process.pid} \${Date.now()} \${(performance.now() / 1000).toFixed(3)} \${l} \${process.argv[2] ?? ""}\\n\`); } catch {} };\n${T("module-eval")}\n`],
  ["function integrityProblem(db) {\n", (a) => `${a}  ${T("integrity-begin")}\n`],
  ["  const messages = rows.map((row2) => String(row2.integrity_check));\n", (a) => `  ${T("integrity-end")}\n${a}`],
  ["async function openDaemon(rootArgument, now, awaitLockMs, vacantLockWaitMs = VACANT_LOCK_WAIT_MS, decideWithinMs = DAEMON_START_BUSY_TIMEOUT_MS) {\n", (a) => `${a}  ${T("openDaemon-begin")}\n`],
  ["    const opened = openStore(commonDir, {\n      checkIntegrity: true,", (a) => `    ${T("lock-held")}\n${a}`],
  ["  return { root, commonDir, worktreeId, store, lock: lock2, scratch, leftovers: leftovers2 };", (a) => `  ${T("opened")}\n${a}`],
  ["      this.#register();\n", (a) => `${a}      ${T("registered")}\n`],
  ["      const { storePaths: storePaths2 } = await Promise.resolve().then(() => (init_store5(), store_exports));\n", (a) => `      ${T("modules-loaded")}\n${a}`],
  ["      await loop.start();\n", (a) => `      ${T("loop-start")}\n${a}      ${T("loop-started")}\n`],
  ["  const started2 = await keys.bootstrap(context.head);\n", (a) => `  ${T("scan-bootstrap-begin")}\n${a}  ${T("scan-bootstrap-end")}\n`],
  ["  takeHeldFiles(store, worktreeId);\n  await readEnvironments(context, failures, bound);\n", (a) => `  ${T("baseline-begin")}\n${a}  ${T("environments-read")}\n`],
  ["  ledger.listingFailed = listed5 === null;\n  const previousKeys = new Map(\n", (a) => `  ${T("listed")}\n${a}`],
  ["  await resolveClosures(context, unresolved, failures, bound);\n", (a) => `  ${T("closures-from-store-set")}\n${a}  ${T("unresolved-resolved " + "")}\n`],
  ["  const first = lookup(refs2);\n", (a) => `${a}  ${T("first-lookup")}\n`],
  ["  const misses = [\n    ...first.filter((file) => !fromStore.has(file.id)),", (a) => `  ${T("recheck-resolved")}\n${a}`],
  ["  ledger.commit({ refined: number, ...ledger.listingFailed ? {} : { listed: number } });\n", (a) => `  ${T("commit-begin")}\n${a}  ${T("committed")}\n`],
  ["      this.#log(`serving ${root} on ${this.#socketPath}`);\n", (a) => `${a}      ${T("serving")}\n`],
];
for (const [anchor, replace] of edits) {
  const count = text.split(anchor).length - 1;
  if (count !== 1) throw new Error(`anchor found ${count} times: ${anchor.slice(0, 80)}`);
  text = text.replace(anchor, typeof replace === "string" ? replace : replace(anchor));
}
writeFileSync(output, text, { mode: 0o755 });
console.log(`patched ${edits.length} anchors -> ${output}`);
