/**
 * Wolfram|Alpha (fork, 2026-11-08): the teacher's math checker and the
 * fallback judge for math answers the app's own check can't decide.
 * Needs WOLFRAM_APP_ID (Settings → Providers); without it everything here
 * reports "unavailable" and the callers fall back to today's behavior.
 *
 * - llmQuery: the LLM API (text built for models: results, steps, pods).
 * - shortAnswer: the Short Answers API (one plain line, e.g. "0").
 * Calls are counted per month in data/wolfram-usage.json (free tier: 2,000).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { keyValue } from "./keys.ts";

export const WOLFRAM_KEY = "WOLFRAM_APP_ID";
const TIMEOUT_MS = 20_000;
const USAGE_FILE = () => path.join(PATHS.data, "wolfram-usage.json");

export function wolframAvailable(): boolean {
	return !!keyValue(WOLFRAM_KEY);
}

const month = () => new Date().toISOString().slice(0, 7);

export function wolframUsage(): { month: string; calls: number } {
	try {
		const raw = JSON.parse(fs.readFileSync(USAGE_FILE(), "utf-8")) as Record<string, unknown>;
		const n = Number(raw[month()]);
		return { month: month(), calls: Number.isFinite(n) ? n : 0 };
	} catch {
		return { month: month(), calls: 0 };
	}
}

function countCall() {
	try {
		let raw: Record<string, number> = {};
		try {
			raw = JSON.parse(fs.readFileSync(USAGE_FILE(), "utf-8")) as Record<string, number>;
		} catch {
			/* first call */
		}
		raw[month()] = (Number(raw[month()]) || 0) + 1;
		fs.mkdirSync(PATHS.data, { recursive: true });
		writeFileAtomicSync(USAGE_FILE(), JSON.stringify(raw, null, "\t"), { allowInPlaceFallback: true });
	} catch {
		/* the counter is informational */
	}
}

async function get(url: string, signal?: AbortSignal): Promise<{ status: number; text: string }> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
	const onAbort = () => ctl.abort();
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const res = await fetch(url, { signal: ctl.signal });
		countCall();
		return { status: res.status, text: await res.text() };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

/** The LLM API: a model-oriented text answer. Throws on missing key / HTTP errors. */
export async function wolframLlmQuery(input: string, signal?: AbortSignal): Promise<string> {
	const appid = keyValue(WOLFRAM_KEY);
	if (!appid) throw new Error("Wolfram nije podešen (Settings → Providers → Wolfram App ID).");
	const url = `https://www.wolframalpha.com/api/v1/llm-api?input=${encodeURIComponent(input)}&appid=${encodeURIComponent(appid)}&maxchars=3500`;
	const { status, text } = await get(url, signal);
	if (status === 501) return `Wolfram|Alpha did not understand the query. ${text.slice(0, 500)}`;
	if (status === 403) throw new Error("Wolfram App ID is invalid or not allowed for the LLM API.");
	if (status !== 200) throw new Error(`Wolfram|Alpha error ${status}: ${text.slice(0, 200)}`);
	return text;
}

/** The Short Answers API: one line, or null when Wolfram has no short answer. */
export async function wolframShortAnswer(input: string, signal?: AbortSignal): Promise<string | null> {
	const appid = keyValue(WOLFRAM_KEY);
	if (!appid) return null;
	const url = `https://api.wolframalpha.com/v1/result?i=${encodeURIComponent(input)}&appid=${encodeURIComponent(appid)}`;
	const { status, text } = await get(url, signal);
	return status === 200 ? text.trim() : null;
}

/** Plain-math sanity for expressions sent from the learner's math field. */
const SAFE_EXPR = /^[\w\s+\-*/^().,=<>!|[\]{}'πθ√∞°·]+$/u;

/** Is `given` equal to `expected`? Asks Wolfram to simplify their difference. */
export async function wolframEqual(expected: string, given: string, signal?: AbortSignal): Promise<"equal" | "different" | "undecided"> {
	const a = expected.trim();
	const b = given.trim();
	if (!a || !b || a.length > 400 || b.length > 400 || !SAFE_EXPR.test(a) || !SAFE_EXPR.test(b)) return "undecided";
	const answer = await wolframShortAnswer(`simplify ((${a}) - (${b}))`, signal).catch(() => null);
	if (answer === null) return "undecided";
	const t = answer.replace(/\s+/g, " ").trim();
	if (/^0(\.0+)?$/.test(t)) return "equal";
	// A plain non-zero number means they differ; anything symbolic stays open.
	if (/^-?\d+(\.\d+)?$/.test(t) || /^-?\d+\/\d+$/.test(t)) return "different";
	return "undecided";
}
