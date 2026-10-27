import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import type { CodexHook } from "../../src/cli/codex/trust.js";

/** Real Codex JSON-RPC, with bounded requests and notifications retained for proof. */
export async function appServer(cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn("codex", ["app-server"], { cwd, env });
  const closed = once(child, "close");
  const notifications: { method: string; params: Record<string, unknown> }[] = [];
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  const lines = createInterface({ input: child.stdout });
  let next = 0;
  let stderr = "";
  child.stderr.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  lines.on("line", (line) => {
    const m = JSON.parse(line) as Record<string, unknown>;
    if (typeof m.id === "number" && m.method === undefined) pending.get(m.id)?.(m);
    if (typeof m.method === "string") {
      notifications.push({ method: m.method, params: m.params as Record<string, unknown> });
    }
  });
  const request = <T = Record<string, unknown>>(method: string, params: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex ${method} timed out: ${stderr.slice(-1000)}`));
      }, 15_000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        pending.delete(id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result as T);
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const close = async () => {
    child.stdin.end();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
    await closed;
    clearTimeout(timer);
    lines.close();
  };
  try {
    await request("initialize", {
      clientInfo: { name: "squeal-shipped-proof", version: "1" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
  } catch (error) {
    await close();
    throw error;
  }
  return {
    request,
    close,
    notifications,
    async hooks(): Promise<CodexHook[]> {
      const r = await request<{ data: { hooks: CodexHook[] }[] }>("hooks/list", { cwds: [cwd] });
      return r.data.flatMap((d) => d.hooks).filter((h) => h.pluginId === "squeal@hearsay");
    },
    async thread(): Promise<string> {
      const r = await request<{ thread: { id: string } }>("thread/start", {
        cwd,
        model: "gpt-6.1-sol",
        modelProvider: "openai-offline-proof",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        persistExtendedHistory: true,
      });
      return r.thread.id;
    },
    async turn(threadId: string): Promise<void> {
      const from = notifications.length;
      const result = await request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input: [{ type: "text", text: "Reply ready." }],
      });
      const deadline = Date.now() + 15_000;
      while (
        !notifications
          .slice(from)
          .some((m) => m.method === "error" || m.method === "turn/completed")
      ) {
        if (Date.now() >= deadline)
          throw new Error(
            `Codex first turn deadline: ${JSON.stringify(notifications.slice(from))} ${stderr.slice(-1000)}`,
          );
        await sleep(20);
      }
      if (!notifications.slice(from).some((m) => m.method === "turn/completed")) {
        await request("turn/interrupt", { threadId, turnId: result.turn.id });
        while (!notifications.slice(from).some((m) => m.method === "turn/completed")) {
          if (Date.now() >= deadline) throw new Error("Codex interrupt deadline");
          await sleep(20);
        }
      }
    },
  };
}
