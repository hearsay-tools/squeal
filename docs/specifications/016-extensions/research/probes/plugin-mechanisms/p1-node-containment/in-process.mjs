// Host loads the plugin in its own thread and guards each call with a timeout.
import { check } from './plugin.mjs';
const mode = process.argv[2];
const guard = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout after ${ms} ms`)), ms))]);
const started = Date.now();
setTimeout(() => console.log(`[host] heartbeat timer fired`), 200);
try {
  const out = await guard(Promise.resolve().then(() => check(mode)), 500);
  console.log(`[host] plugin returned ${out}`);
} catch (e) { console.log(`[host] caught: ${e.message}`); }
console.log(`[host] after call, [1].includes(2) = ${[1].includes(2)}`);
