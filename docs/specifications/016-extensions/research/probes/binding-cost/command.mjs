// Throwaway probe for 016-34: the per-run command binding's command. One
// process per run: argv[2] is the provider's options as JSON, argv[3] the
// report path, the rest the units to run. Writes the report, exits 0.
import { writeFileSync } from "node:fs";
import { createProvider } from "./provider.mjs";

const [options, reportPath, ...files] = process.argv.slice(2);
const report = await createProvider(JSON.parse(options)).run(files);
writeFileSync(reportPath, JSON.stringify(report));
