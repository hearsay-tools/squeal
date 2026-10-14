import { runEntry } from "../../bridge.js";
import { before } from "../../bridge-turn.js";

// The `before` bridge entry (spec 008 D4), bundled as `dist/hooks/before.mjs`.
await runEntry(import.meta.url, "before", before);
