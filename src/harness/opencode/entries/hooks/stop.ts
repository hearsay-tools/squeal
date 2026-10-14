import { runEntry } from "../../bridge.js";
import { stop } from "../../bridge-turn.js";

// The `stop` bridge entry (spec 008 D4), bundled as `dist/hooks/stop.mjs`.
await runEntry(import.meta.url, "stop", stop);
