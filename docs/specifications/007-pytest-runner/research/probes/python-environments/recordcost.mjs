// Throwaway: cost of hashing every RECORD file of a venv (file hashes of each installed package).
import { readdirSync, readFileSync } from "node:fs"; import { createHash } from "node:crypto"; import { join } from "node:path";
const v = process.argv[2]; const lib = readdirSync(join(v, "lib")).find((d) => d.startsWith("python"));
const sp = join(v, "lib", lib, "site-packages"); const t0 = process.hrtime.bigint(); const h = createHash("sha256"); let bytes = 0, n = 0;
for (const e of readdirSync(sp).sort()) if (e.endsWith(".dist-info")) { const b = readFileSync(join(sp, e, "RECORD")); bytes += b.length; n++; h.update(e).update(b); }
console.log(JSON.stringify({ dists: n, recordBytes: bytes, ms: +(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2) }));
