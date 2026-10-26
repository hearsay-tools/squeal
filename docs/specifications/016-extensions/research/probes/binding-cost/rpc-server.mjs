// Throwaway probe for 016-34: the persistent stdio JSON-RPC binding's
// provider process. argv[2] is the provider's options as JSON. stdout carries
// protocol frames only; nothing else writes to it.
import { createProvider } from "./provider.mjs";
import { frame, reader } from "./framing.mjs";

const provider = createProvider(JSON.parse(process.argv[2]));
const send = (message) => process.stdout.write(frame(message));
const methods = {
  invalidate: ([paths]) => provider.invalidate(paths),
  affected: ([paths]) => provider.affected(paths),
  closure: ([unit]) => provider.closure(unit),
  tierWidth: ([unit, grant]) => provider.tierWidth(unit, grant),
  run: ([files]) => provider.run(files),
  // The probe's own accounting, called outside every timed span.
  "$/cpu": () => {
    const { user, system } = process.cpuUsage();
    return { cpuUs: user + system, rss: process.memoryUsage().rss };
  },
};
process.stdin.on(
  "data",
  reader(async ({ id, method, params }) => {
    try {
      send({ jsonrpc: "2.0", id, result: await methods[method](params) });
    } catch (error) {
      send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(error?.message ?? error) } });
    }
  }),
);
process.stdin.on("end", () => process.exit(0));
