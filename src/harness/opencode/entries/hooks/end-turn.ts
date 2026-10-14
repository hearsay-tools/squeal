import { runEntry } from "../../bridge.js";
import { endTurn } from "../../bridge-turn.js";

// The `endTurn` bridge entry (spec 008 D4), bundled as `dist/hooks/end-turn.mjs`.
await runEntry(import.meta.url, "endTurn", endTurn);
