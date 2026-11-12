/**
 * Fork (2026-11-12, owner: web search "via Claude subscription"): a keyless
 * search engine — one short Claude Code run (Haiku) with ONLY its built-in
 * WebSearch tool, asked to return the hits as JSON. Same isolation as the
 * tutor's CLI turns: a fresh empty working folder, no hooks, no CLAUDE.md,
 * no MCP servers, no session saved. Costs a little plan usage per search.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeLauncher } from "../agent/claude-code/launch.ts";
import type { RunClaude } from "../agent/claude-code/stream.ts";
import { externalCliEnv } from "../core/auth-env.ts";
import type { SearchHit, SearchProvider } from "../core/search.ts";

const TIMEOUT_MS = 120_000;

/** Stop the CLI and anything it started (Windows: the whole process tree). */
function killTree(pid: number | undefined, fallback: () => void): void {
	if (pid === undefined) return fallback();
	if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", fallback);
	else fallback();
}
const OUTPUT_LIMIT = 1024 * 1024;

export function claudeSearchArgs(query: string, count: number): string[] {
	const n = Math.max(1, Math.min(10, Math.round(count) || 5));
	const prompt =
		`Use WebSearch to search the web for: ${JSON.stringify(query)}\n` +
		`Then reply with ONLY a JSON array (no prose, no code fence) of up to ${n} objects {"title","url","snippet"} ` +
		"for the best results, in order; each snippet under 300 characters, taken or closely summarized from that result.";
	return [
		"-p", prompt,
		"--model", "haiku",
		"--output-format", "json",
		"--tools", "WebSearch",
		"--allowedTools", "WebSearch",
		"--strict-mcp-config",
		"--setting-sources", "user",
		"--settings", JSON.stringify({ disableAllHooks: true, env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" } }),
		"--disable-slash-commands",
		"--no-session-persistence",
		"--permission-prompts", "none",
	];
}

/** The CLI's `--output-format json` envelope → hits. Throws a clear error. */
/** The first `[` ... `]` span that parses as a JSON array (prose around the
 *  answer may hold other brackets, e.g. "results [1]:"). */
function firstJsonArray(text: string): unknown[] | null {
	const opens: number[] = [];
	const closes: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "[") opens.push(i);
		else if (text[i] === "]") closes.push(i);
	}
	let tries = 0;
	for (const start of opens) {
		for (let k = closes.length - 1; k >= 0 && closes[k]! > start; k--) {
			if (++tries > 2_000) return null;
			try {
				const value = JSON.parse(text.slice(start, closes[k]! + 1)) as unknown;
				// Results are objects: a stray "[1]" in prose is not the answer.
				if (Array.isArray(value) && value.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) return value;
			} catch { /* try a shorter span */ }
		}
	}
	return null;
}

export function parseClaudeSearchOutput(stdout: string): SearchHit[] {
	let envelope: { is_error?: boolean; result?: unknown; subtype?: string };
	try { envelope = JSON.parse(stdout.trim()); }
	catch { throw new Error("Claude search returned an unreadable answer"); }
	if (envelope.is_error || typeof envelope.result !== "string") {
		throw new Error(`Claude search failed${envelope.subtype ? ` (${envelope.subtype})` : ""}`);
	}
	const rows = firstJsonArray(envelope.result);
	if (rows === null) throw new Error(envelope.result.includes("[") ? "Claude search returned results in an unreadable form" : "Claude search found no results");
	return rows.flatMap((row): SearchHit[] => {
		const r = row as Record<string, unknown>;
		if (typeof r?.url !== "string" || !/^https?:\/\//i.test(r.url)) return [];
		return [{ title: typeof r.title === "string" ? r.title : r.url, url: r.url, snippet: typeof r.snippet === "string" ? r.snippet : "" }];
	});
}

export function claudeSearchProvider(run: RunClaude = createClaudeLauncher()): SearchProvider {
	return {
		id: "claude",
		async search(query: string, count: number, signal?: AbortSignal): Promise<SearchHit[]> {
			if (signal?.aborted) throw new Error("Search cancelled");
			const cwd = await mkdtemp(join(tmpdir(), "lh-claude-search-"));
			try {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
				// The tool's own stop (turn stopped, tool time limit) ends the run too.
				const forward = () => controller.abort();
				signal?.addEventListener("abort", forward, { once: true });
				try {
					const child = await run(claudeSearchArgs(query, count), {
						cwd,
						env: { ...externalCliEnv(), CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" },
						signal: controller.signal,
					});
					if (!child) throw new Error("Claude Code is not installed on this computer");
					const stdout = await new Promise<string>((resolve, reject) => {
						const chunks: Buffer[] = [];
						let size = 0;
						const onAbort = () => {
							killTree(child.pid, () => child.kill());
							reject(new Error(signal?.aborted ? "Search cancelled" : `Claude search took longer than ${TIMEOUT_MS / 1000} s`));
						};
						if (controller.signal.aborted) { onAbort(); return; }
						controller.signal.addEventListener("abort", onAbort, { once: true });
						child.stdout.on("data", (b: Buffer) => { if (size < OUTPUT_LIMIT) { chunks.push(b); size += b.length; } });
						child.stderr.on("data", () => {});
						child.on("error", (e) => reject(e));
						child.on("close", () => { controller.signal.removeEventListener("abort", onAbort); resolve(Buffer.concat(chunks).toString("utf8")); });
						child.stdin.end();
					});
					return parseClaudeSearchOutput(stdout);
				} finally {
					clearTimeout(timer);
					signal?.removeEventListener("abort", forward);
				}
			} finally {
				await rm(cwd, { recursive: true, force: true }).catch(() => {});
			}
		},
	};
}
