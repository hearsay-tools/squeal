// Throwaway probe plugin for wave-0 check 4 (open question 2): in `chat.message`, push a text
// part onto `output.parts` and see whether it reaches the model's request. PROBE_Q2 picks the
// part's shape:
//   after      id = the last part's id + "z" (PartID must start with "prt"; parts sort by id)
//   synthetic  the same with `synthetic: true`
//   noid       no id at all
import { appendFileSync } from "node:fs";

export const SquealQ2 = async () => ({
  "chat.message": async (_input, output) => {
    const variant = process.env.PROBE_Q2 ?? "after";
    const last = output.parts.at(-1);
    const part = {
      type: "text",
      text: `SQUEAL-Q2-${variant}`,
      sessionID: output.message.sessionID,
      messageID: output.message.id,
    };
    if (variant !== "noid") part.id = `${last?.id ?? "prt_"}z`;
    if (variant === "synthetic") part.synthetic = true;
    output.parts.push(part);
    appendFileSync(process.env.PROBE_LOG, `pushed ${variant} part ${part.id ?? "(no id)"}\n`);
  },
});
