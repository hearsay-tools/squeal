// Throwaway probe: async loader hooks via module.register (runs in Node's hooks
// thread). Same output format as hook-sync.mjs, kind "aresolve"/"aload".
import { register } from "node:module";
register("./hook-async-worker.mjs", import.meta.url, { data: { out: process.env.LM_OUT, pid: process.pid } });
