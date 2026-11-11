/**
 * Fork (2026-11-11): run a Test znanja code question's tests. Same contract
 * as the Coding questions plugin (so the same teacher instructions apply): a
 * fresh working folder, the learner's code in `answer.txt`, `tests.program`
 * started directly (no shell) with `tests.args`, `tests.code` on its stdin, a
 * 30 s limit and capped output; the folder is removed afterwards.
 *
 * The tests always come from the stored placement_test call — never from the
 * browser — so only programs the teacher wrote can run. Public examples run
 * whenever the learner asks; hidden tests run on submit for the grader.
 * Local code is NOT sandboxed (the plugin's own caveat): it runs with the
 * app's user permissions.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { CodeRunSummary, PlacementQuestion, PlacementTestInput, PlacementTests } from "../core";
import { stores } from "./stores.ts";

const TIMEOUT_MS = 30_000;
const OUTPUT_LIMIT = 64 * 1024;
const MAX_CODE = 200_000;

/** The code question `qid` of the placement_test call `toolCallId`. */
export function placementCodeQuestion(chatId: string, toolCallId: string, qid: string): PlacementQuestion | null {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return null;
	for (const m of chat.messages) {
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		for (const b of m.content) {
			if (b.type !== "toolCall" || b.id !== toolCallId || b.name !== "placement_test") continue;
			const test = b.arguments as Partial<PlacementTestInput> | undefined;
			for (const t of test?.topics ?? []) for (const q of t.questions ?? []) if (q.id === qid && q.kind === "code") return q;
			return null;
		}
	}
	return null;
}

function collect() {
	const chunks: Buffer[] = [];
	let length = 0;
	let truncated = false;
	return {
		push(b: Buffer) {
			if (length >= OUTPUT_LIMIT) { truncated = true; return; }
			const take = b.subarray(0, OUTPUT_LIMIT - length);
			chunks.push(take);
			length += take.length;
			if (take.length < b.length) truncated = true;
		},
		text() {
			// A byte cut can split a UTF-8 character: drop a broken tail.
			const t = Buffer.concat(chunks).toString("utf8").replace(/�+$/, "");
			return truncated ? `${t}\n… [output cut]` : t;
		},
	};
}

/** Run one test set against the learner's code. */
export async function runPlacementTests(code: string, tests: PlacementTests, runId: string, timeoutMs = TIMEOUT_MS): Promise<CodeRunSummary> {
	const root = path.join(PATHS.data, "placement-runs");
	await mkdir(root, { recursive: true });
	const work = await mkdtemp(path.join(root, `${runId}-`));
	try {
		await writeFile(path.join(work, "answer.txt"), code, "utf8");
		return await new Promise<CodeRunSummary>((resolve) => {
			const out = collect();
			const err = collect();
			let timedOut = false;
			let settled = false;
			let exitCode: number | null = null;
			let child: ReturnType<typeof spawn>;
			try {
				child = spawn(tests.program, tests.args, { cwd: work, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
			} catch (e) {
				resolve({ status: "error", exitCode: null, stdout: "", stderr: `Could not start "${tests.program}": ${e instanceof Error ? e.message : e}` });
				return;
			}
			// The whole tree: a python driver runs g++ and prog.exe, and killing
			// only the root leaves a looping prog.exe holding the folder.
			let termination: Promise<void> | undefined;
			const terminate = () => {
				if (termination) return termination;
				if (child.pid === undefined) return (termination = Promise.resolve());
				if (process.platform !== "win32") {
					try { process.kill(-child.pid, "SIGKILL"); } catch { /* no group */ }
					child.kill("SIGKILL");
					return (termination = Promise.resolve());
				}
				return (termination = new Promise<void>((ok) => {
					const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
					killer.on("error", () => { child.kill(); ok(); });
					killer.on("close", () => { child.kill(); ok(); });
				}));
			};
			let grace: ReturnType<typeof setTimeout> | undefined;
			const finish = async (r: () => CodeRunSummary, kill: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				clearTimeout(grace);
				if (kill) await terminate();
				// Never wait on pipes a stray descendant may hold open.
				child.stdin?.destroy();
				child.stdout?.destroy();
				child.stderr?.destroy();
				resolve(r());
			};
			const summary = (): CodeRunSummary => ({
				status: timedOut ? "failed" : exitCode === 0 ? "passed" : "failed",
				exitCode,
				stdout: out.text(),
				stderr: timedOut ? `${err.text()}\nStopped after ${timeoutMs / 1000} s.`.trim() : err.text(),
				...(timedOut ? { timedOut: true } : {}),
			});
			const timer = setTimeout(() => { timedOut = true; void finish(summary, true); }, timeoutMs);
			child.stdout?.on("data", (b: Buffer) => out.push(b));
			child.stderr?.on("data", (b: Buffer) => err.push(b));
			child.on("error", (e) => {
				void finish(() => ({ status: "error", exitCode: null, stdout: out.text(), stderr: `Could not start "${tests.program}": ${e.message}` }), true);
			});
			child.on("exit", (code) => {
				exitCode = code;
				// The root is done; give the pipes a moment to drain, then stop
				// waiting even if a grandchild still holds them.
				grace = setTimeout(() => void finish(summary, false), 2_000);
			});
			child.on("close", (code) => {
				exitCode = code ?? exitCode;
				void finish(summary, false);
			});
			child.stdin?.on("error", () => {}); // a program that exits early closes stdin
			child.stdin?.end(tests.code);
		});
	} finally {
		await rm(work, { recursive: true, force: true }).catch(() => {});
	}
}

export type PlacementRunRequest = { toolCallId: string; qid: string; code: string; which: "public" | "hidden" };

export function parsePlacementRun(body: unknown): PlacementRunRequest | string {
	const b = (body ?? {}) as Record<string, unknown>;
	// Only looked up in the stored record (OpenAI ids contain "|"); never a path.
	if (typeof b.toolCallId !== "string" || !b.toolCallId || b.toolCallId.length > 300) return "toolCallId is required";
	if (typeof b.qid !== "string" || !b.qid || b.qid.length > 40) return "qid is required";
	if (typeof b.code !== "string" || b.code.length > MAX_CODE) return `code must be a string up to ${MAX_CODE} characters`;
	if (b.which !== "public" && b.which !== "hidden") return 'which must be "public" or "hidden"';
	return { toolCallId: b.toolCallId, qid: b.qid, code: b.code, which: b.which };
}

export async function runPlacementCode(chatId: string, req: PlacementRunRequest): Promise<CodeRunSummary | { error: string; status: number }> {
	const q = placementCodeQuestion(chatId, req.toolCallId, req.qid);
	if (!q) return { error: "No such code question in this session's placement test", status: 404 };
	const tests = req.which === "public" ? q.publicTests : q.tests;
	if (!tests) return { error: `This question has no ${req.which} tests`, status: 409 };
	return runPlacementTests(req.code, tests, `${req.toolCallId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}-${req.which}`);
}
