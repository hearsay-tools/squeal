import { runEntry } from "../../bridge.js";
import { after } from "../../bridge-turn.js";

// The `after` bridge entry (spec 008 D4), bundled as `dist/hooks/after.mjs`.
await runEntry(import.meta.url, "after", after);
