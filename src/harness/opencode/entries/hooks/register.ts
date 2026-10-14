import { register, runEntry } from "../../bridge.js";

// The `register` bridge entry (spec 008 D4), bundled as `dist/hooks/register.mjs`.
await runEntry(import.meta.url, "register", register);
