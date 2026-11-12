/**
 * Fork (2026-11-12, owner: "Bypass mode" toggle): write_file, edit_file and
 * run_command for the session agents, registered ONLY when Settings →
 * Agent → Tools → Access is "Bypass". No approval prompts (the owner's
 * choice, like Claude Code's bypass-permissions mode).
 *
 * File writes keep the shared credential denials (fs-shared) and never touch
 * LearnHarness's own data folder (a write there could corrupt the running
 * session). run_command cannot be fenced by path: it runs PowerShell (sh
 * elsewhere) with the app's user rights, minus secret-looking environment
 * variables, with a time limit and capped output; on a timeout the whole
 * process tree is killed.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { externalCliEnv } from "../../core/auth-env.ts";
import { serverExecute } from "../tool-execute.ts";
import { resolveWritablePath } from "./fs-shared.ts";

const OUTPUT_CHARS = 30_000;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;
const SECRET_ENV = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
/** The server's own process settings, never the learner's programs' (a
 *  learner's dev server must not take the app's PORT, npm must not see
 *  NODE_ENV=production, electron must not run as plain node). */
const SERVER_ENV = new Set(["PORT", "HOSTNAME", "NODE_ENV", "ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"]);

const clip = (t: string) => (t.length > OUTPUT_CHARS ? `${t.slice(0, OUTPUT_CHARS)}\n… [cut at ${OUTPUT_CHARS} characters]` : t);

const writeInput = Type.Object({
	path: Type.String({ minLength: 1, description: "File to write (absolute, or relative to the learner's home folder)." }),
	content: Type.String({ description: "The full text to write." }),
	append: Type.Optional(Type.Boolean({ description: "Add to the end instead of replacing the file." })),
});

const editInput = Type.Object({
	path: Type.String({ minLength: 1, description: "File to edit (absolute, or relative to the learner's home folder)." }),
	old_text: Type.String({ minLength: 1, description: "Exact text to replace (must appear exactly once unless replace_all)." }),
	new_text: Type.String({ description: "Replacement text." }),
	replace_all: Type.Optional(Type.Boolean({ description: "Replace every occurrence." })),
});

const runInput = Type.Object({
	command: Type.String({ minLength: 1, description: process.platform === "win32" ? "A PowerShell command (or script)." : "A shell command." }),
	cwd: Type.Optional(Type.String({ description: "Working folder (default: the learner's home folder)." })),
	timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_S, description: `Time limit (default ${DEFAULT_TIMEOUT_S}).` })),
});

const CARE =
	"Bypass mode: no confirmation is asked, so act only on what the learner asked for or clearly needs for his learning. " +
	"Ask him in chat before deleting anything or overwriting a file he did not ask you to change.";

export function systemAccessTools(): Record<string, AgentTool<any>> {
	const write_file: AgentTool<typeof writeInput> = {
		name: "write_file",
		label: "write_file",
		description: `Create or overwrite a text file anywhere on this computer (parent folders are created). ${CARE}`,
		parameters: writeInput,
		execute: serverExecute("write_file", writeInput, async ({ path: p, content, append }) => {
			const target = resolveWritablePath(p);
			await fs.mkdir(path.dirname(target), { recursive: true });
			if (append) await fs.appendFile(target, content, "utf8");
			else await fs.writeFile(target, content, "utf8");
			return `${append ? "Appended to" : "Wrote"} ${target} (${Buffer.byteLength(content, "utf8")} bytes).`;
		}),
	};
	const edit_file: AgentTool<typeof editInput> = {
		name: "edit_file",
		label: "edit_file",
		description: `Replace exact text in a text file on this computer. ${CARE}`,
		parameters: editInput,
		execute: serverExecute("edit_file", editInput, async ({ path: p, old_text, new_text, replace_all }) => {
			const target = resolveWritablePath(p);
			const text = await fs.readFile(target, "utf8");
			const count = text.split(old_text).length - 1;
			if (count === 0) throw new Error(`old_text was not found in ${target}. Read the file and copy the text exactly.`);
			if (count > 1 && !replace_all) throw new Error(`old_text appears ${count} times in ${target}; add more surrounding text or set replace_all.`);
			const next = replace_all ? text.split(old_text).join(new_text) : text.replace(old_text, () => new_text);
			await fs.writeFile(target, next, "utf8");
			return `Edited ${target} (${replace_all ? count : 1} replacement${(replace_all ? count : 1) === 1 ? "" : "s"}).`;
		}),
	};
	const run_command: AgentTool<typeof runInput> = {
		name: "run_command",
		label: "run_command",
		description:
			`Run a ${process.platform === "win32" ? "PowerShell" : "shell"} command on this computer and get its exit code and output ` +
			`(time limit ${DEFAULT_TIMEOUT_S} s by default, up to ${MAX_TIMEOUT_S}). For running the learner's programs, checking what is installed, ` +
			`inspecting files or folders, and tasks he asks for. Never touch credential folders or LearnHarness's own data. ${CARE}`,
		parameters: runInput,
		execute: serverExecute("run_command", runInput, async ({ command, cwd, timeout_seconds }, { signal }) => {
			const folder = cwd ? resolveWritablePath(cwd) : (await import("node:os")).homedir();
			return await runCommand(command, folder, (timeout_seconds ?? DEFAULT_TIMEOUT_S) * 1000, signal);
		}, { timeoutMs: ({ timeout_seconds }) => (timeout_seconds ?? DEFAULT_TIMEOUT_S) * 1000 + 15_000 }),
	};
	return { write_file, edit_file, run_command };
}

export function commandEnv(env: NodeJS.ProcessEnv = externalCliEnv()): NodeJS.ProcessEnv {
	const out: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(env)) {
		if (SECRET_ENV.test(k) || k.startsWith("LH_") || k.startsWith("__NEXT") || k.startsWith("NEXT_") || SERVER_ENV.has(k.toUpperCase())) continue;
		out[k] = v;
	}
	return out as NodeJS.ProcessEnv;
}

export async function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
	// PowerShell 5.1 writes piped output in the console code page: force UTF-8
	// so Serbian letters (č ć š đ ž) and folder names come back intact.
	const utf8 = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ";
	const [program, args] = process.platform === "win32"
		? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", utf8 + command]]
		: ["/bin/sh", ["-c", command]];
	return await new Promise<string>((resolve) => {
		const out: string[] = [];
		const err: string[] = [];
		let outLen = 0, errLen = 0, timedOut = false, settled = false;
		const child = spawn(program, args as string[], { cwd, env: commandEnv(), windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
		const killTree = () => {
			if (child.pid === undefined) return;
			if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
			else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
		};
		const finish = (code: number | null, note?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			child.stdout?.destroy();
			child.stderr?.destroy();
			const parts = [`exit ${code ?? "none"}${timedOut ? ` (stopped after ${timeoutMs / 1000} s)` : ""}${note ? ` — ${note}` : ""}`];
			const o = out.join(""), e = err.join("");
			if (o.trim()) parts.push(`--- output ---\n${clip(o)}`);
			if (e.trim()) parts.push(`--- errors ---\n${clip(e)}`);
			resolve(parts.join("\n"));
		};
		const onAbort = () => { killTree(); finish(null, "cancelled"); };
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort(); // an already-aborted signal never fires listeners
		const timer = setTimeout(() => { timedOut = true; killTree(); setTimeout(() => finish(null), 1_500); }, timeoutMs);
		child.stdout?.on("data", (b: Buffer) => { if (outLen <= OUTPUT_CHARS) { out.push(b.toString("utf8")); outLen += b.length; } });
		child.stderr?.on("data", (b: Buffer) => { if (errLen <= OUTPUT_CHARS) { err.push(b.toString("utf8")); errLen += b.length; } });
		child.on("error", (e) => finish(null, `could not start: ${e.message}`));
		child.on("exit", (code) => setTimeout(() => finish(code), 300));
	});
}
