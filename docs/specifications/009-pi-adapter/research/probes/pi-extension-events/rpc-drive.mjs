// THROWAWAY research probe: drive `pi --mode rpc` from a JSON script of steps.
// usage: node rpc-drive.mjs <steps.json> <out.jsonl> -- <pi args...>
// steps: {"send":{cmd}} | {"waitFor":"agent_settled","count":1,"timeoutMs":20000} | {"sleep":ms} | {"close":true} | {"kill":"SIGTERM"}
import { spawn } from "node:child_process";
import * as fs from "node:fs";

const [stepsPath, outPath, , ...piArgs] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsPath, "utf8"));
const out = fs.openSync(outPath, "a");
const rec = (r) => fs.writeSync(out, `${JSON.stringify({ t: Date.now(), ...r })}\n`);

const child = spawn("pi", ["--mode", "rpc", ...piArgs], { stdio: ["pipe", "pipe", "pipe"] });
const seen = [];
let buf = "";
const responses = {};
child.stdout.on("data", (d) => {
	buf += d.toString("utf8");
	let i;
	while ((i = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		try {
			const r = JSON.parse(line);
			seen.push(r.type);
			if (r.type === "response" && r.id) responses[r.id] = r;
			if (r.type !== "message_update") rec({ dir: "out", type: r.type, r: r.type === "response" || r.type === "extension_ui_request" || r.type === "extension_error" ? r : summarise(r) });
		} catch {
			rec({ dir: "out-raw", line: line.slice(0, 300) });
		}
	}
});
child.stderr.on("data", (d) => rec({ dir: "stderr", text: d.toString("utf8").slice(0, 2000) }));
const exited = new Promise((r) => child.on("exit", (code, signal) => { rec({ dir: "exit", code, signal }); r(); }));

function summarise(r) {
	const s = { ...r };
	for (const k of ["message", "messages", "toolResults", "result", "partialResult", "assistantMessageEvent"]) if (k in s) s[k] = "[omitted]";
	return s;
}
const waitFor = (type, count, timeoutMs) =>
	new Promise((resolve) => {
		const start = seen.filter((t) => t === type).length;
		const t0 = Date.now();
		const tick = () => {
			if (seen.filter((t) => t === type).length - start >= count) return resolve(true);
			if (Date.now() - t0 > timeoutMs) return resolve(false);
			setTimeout(tick, 20);
		};
		tick();
	});

for (const step of steps) {
	if (step.send?.message?.startsWith?.("BIG:")) step.send.message = "filler ".repeat(Number(step.send.message.slice(4)) / 7);
	if (step.send) { rec({ dir: "in", cmd: step.send }); child.stdin.write(`${JSON.stringify(step.send)}\n`); }
	else if (step.waitFor) { const ok = await waitFor(step.waitFor, step.count ?? 1, step.timeoutMs ?? 20000); rec({ dir: "wait", for: step.waitFor, ok }); }
	else if (step.forkFirstUserMessage) {
		// ask for fork points, then fork at the first user message
		child.stdin.write(`${JSON.stringify({ id: "gfm", type: "get_fork_messages" })}\n`);
		await waitFor("response", 1, 5000);
		const entryId = responses.gfm?.data?.messages?.[0]?.entryId;
		const cmd = { id: "fork", type: "fork", entryId };
		rec({ dir: "in", cmd });
		child.stdin.write(`${JSON.stringify(cmd)}\n`);
	}
	else if (step.sleep) await new Promise((r) => setTimeout(r, step.sleep));
	else if (step.close) child.stdin.end();
	else if (step.kill) child.kill(step.kill);
}
const timer = setTimeout(() => { rec({ dir: "driver", note: "pi did not exit in 10s, SIGKILL" }); child.kill("SIGKILL"); }, 10000);
await exited;
clearTimeout(timer);
