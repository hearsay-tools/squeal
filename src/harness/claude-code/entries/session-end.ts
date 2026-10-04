import { sessionEnd } from "../hooks/session-end.js";
import { runMain } from "../main.js";

await runMain("session-end", sessionEnd);
