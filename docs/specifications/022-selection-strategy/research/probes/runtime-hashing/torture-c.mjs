// Throwaway: the torture pairs through Candidate C (sucrase + acorn). SUCRASE_DIR as in cand-c.mjs.
import { normalizeC } from "./cand-c.mjs";
import { CASES } from "./torture.mjs";
for (const [name, ext, a, b, expExact, expNorm = expExact] of CASES) {
  const ra = normalizeC(a, ext), rb = normalizeC(b, ext);
  const got = !ra.ok || !rb.ok ? "fallback" : ra.exact === rb.exact ? "same" : "diff";
  const flag = got === expExact || got === expNorm ? "ok  " : got === "same" ? "FALSE-EQ" : "miss";
  console.log(`${flag} ${name.padEnd(36)} got=${got} want exact=${expExact} norm=${expNorm} ${!ra.ok ? ra.reason : !rb.ok ? rb.reason : ""}`);
}
