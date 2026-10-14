import { end, runEntry } from "../../bridge.js";

// The `end` bridge entry (spec 008 D4), bundled as `dist/hooks/end.mjs`.
await runEntry(import.meta.url, "end", end);
