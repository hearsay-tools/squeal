// Throwaway (issue #101 probe). A port-holder stand-in: ignores SIGTERM and
// ends itself after its lifetime, so a leak can never outlive the probe long.
// Writes `--ready <path>` once the SIGTERM handler is in place.
const { writeFileSync } = require("node:fs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
process.on("SIGTERM", () => {});
const lifetime = Number(arg("--lifetime")) || 60_000;
setTimeout(() => process.exit(0), lifetime);
if (process.argv.includes("--ready")) writeFileSync(arg("--ready"), String(process.pid));
