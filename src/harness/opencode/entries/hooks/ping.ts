import { ping, runEntry } from "../../bridge.js";

// The `ping` bridge entry (spec 008 D4), bundled as `dist/hooks/ping.mjs`.
await runEntry(import.meta.url, "ping", ping);
