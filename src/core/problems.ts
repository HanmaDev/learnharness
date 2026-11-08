/**
 * Problem log (fork, 2026-11-08): every problem the learner works — from any
 * book, zbirka, competition or the Matematika Tracker archive — with its
 * attempts, a category (Matematika — škola / takmičenja / Fizika / own) and a
 * re-solve date derived from the latest outcome (overridable by hand).
 * See docs/fork-plans/problem-log-plan.md. Pure: no runtime deps.
 */
import { toSerbianLatin } from "./serbian-latin.ts";

export const OUTCOMES = ["clean", "slow", "hint", "read", "unsolved"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
	clean: "sam, čisto",
	slow: "sam, sporo",
	hint: "uz hint",
	read: "pročitao rešenje",
	unsolved: "nerešeno",
};
/** Days until the re-solve, by the latest outcome (null = not scheduled). */
export const RESOLVE_DAYS: Record<Outcome, number | null> = { clean: null, slow: 21, hint: 7, read: 3, unsolved: 3 };

export const BRANCHES = ["Algebra", "Analiza", "Geometrija", "Kombinatorika", "Teorija brojeva", "Verovatnoća", "Fizika", "Ostalo"] as const;

export interface ProblemCategory {
	id: string;
	label: string;
}

export const DEFAULT_CATEGORIES: ProblemCategory[] = [
	{ id: "skola", label: "Matematika — škola" },
	{ id: "takmicenja", label: "Matematika — takmičenja" },
	{ id: "fizika", label: "Fizika" },
];

export interface ProblemAttempt {
	id: string;
	/** ISO time. */
	at: string;
	outcome: Outcome;
	minutes?: number;
	note?: string;
	/** Logged by the teacher in this chat (absent = by hand). */
	chatId?: string;
}

export interface ProblemEntry {
	id: string;
	category: string;
	/** "Thomas' Calculus", "EGMO", "DMS arhiva", … */
	source: string;
	/** "3.4 / 17", "Okružno 2019/20 · 4A · z3" */
	reference: string;
	branch?: string;
	/** The course it was (first) worked in. */
	chatId?: string;
	/** The Matematika Tracker problem id, for archive problems. */
	trackerId?: string;
	note?: string;
	attempts: ProblemAttempt[];
	/** A hand-set re-solve date (YYYY-MM-DD), or null = "not scheduled" by
	 *  hand; absent = follow the outcome rule. Cleared by the next attempt. */
	resolveOn?: string | null;
	createdAt: string;
}

export interface ProblemLog {
	version: 1;
	categories: ProblemCategory[];
	/** A course's default category (chat id → category id). */
	courseCategory: Record<string, string>;
	entries: ProblemEntry[];
}

export const emptyProblemLog = (): ProblemLog => ({ version: 1, categories: [...DEFAULT_CATEGORIES], courseCategory: {}, entries: [] });

/** The key two references are "the same problem" by: Cyrillic read as
 *  Latin, case and diacritics ignored, punctuation as spaces — letters of
 *  any script are kept (review: dropping them merged different books). */
export function problemKey(source: string, reference: string): string {
	const norm = (s: string) =>
		toSerbianLatin(s)
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/đ/g, "dj")
			.replace(/[^\p{L}\p{N}]+/gu, " ")
			.trim();
	return `${norm(source)}|${norm(reference)}`;
}

const localDay = (ms: number) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (ms: number, n: number) => {
	const d = new Date(ms);
	return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime());
};

export function lastAttempt(e: ProblemEntry): ProblemAttempt | null {
	return e.attempts.reduce<ProblemAttempt | null>((m, a) => (!m || a.at > m.at ? a : m), null);
}

/** The re-solve date (YYYY-MM-DD) or null when nothing is scheduled. */
export function resolveDate(e: ProblemEntry): string | null {
	if (e.resolveOn !== undefined) return e.resolveOn;
	const last = lastAttempt(e);
	if (!last) return null;
	const days = RESOLVE_DAYS[last.outcome];
	return days === null ? null : addDays(Date.parse(last.at), days);
}

export function isDue(e: ProblemEntry, now: number): boolean {
	const d = resolveDate(e);
	return d !== null && d <= localDay(now);
}

/** The category a newly logged problem gets when none is given. */
export function defaultCategory(log: ProblemLog, source: string, chatId?: string): string {
	const valid = new Set(log.categories.map((c) => c.id));
	const course = chatId && Object.prototype.hasOwnProperty.call(log.courseCategory, chatId) ? log.courseCategory[chatId] : undefined;
	if (course && valid.has(course)) return course;
	const s = source.toLowerCase();
	if (/schaum|fizik|physic/.test(s) && valid.has("fizika")) return "fizika";
	if (/tracker|dms|takmi|predi|olimp|egmo|mont|smo|imo/.test(s) && valid.has("takmicenja")) return "takmicenja";
	return valid.has("skola") ? "skola" : (log.categories[0]?.id ?? "skola");
}

export interface ProblemFilter {
	category?: string;
	source?: string;
	branch?: string;
	outcome?: Outcome;
	q?: string;
}

export function filterProblems(entries: readonly ProblemEntry[], f: ProblemFilter): ProblemEntry[] {
	const q = f.q?.trim().toLowerCase();
	return entries.filter((e) => {
		if (f.category && e.category !== f.category) return false;
		if (f.source && e.source !== f.source) return false;
		if (f.branch && e.branch !== f.branch) return false;
		if (f.outcome && lastAttempt(e)?.outcome !== f.outcome) return false;
		if (q && !`${e.reference} ${e.source} ${e.note ?? ""}`.toLowerCase().includes(q)) return false;
		return true;
	});
}

export interface ProblemCounts {
	total: number;
	due: number;
	/** Problems whose latest attempt was solved alone (clean or slow). */
	alone: number;
	/** …needed a hint or the solution, or is unsolved. */
	helped: number;
}

export function problemCounts(entries: readonly ProblemEntry[], now: number): ProblemCounts {
	let due = 0;
	let alone = 0;
	let helped = 0;
	for (const e of entries) {
		if (isDue(e, now)) due++;
		const o = lastAttempt(e)?.outcome;
		if (o === "clean" || o === "slow") alone++;
		else if (o) helped++;
	}
	return { total: entries.length, due, alone, helped };
}

/** Attempts per local day (for the stats page). */
export function attemptsByDay(entries: readonly ProblemEntry[], category?: string): Map<string, { attempts: number; alone: number }> {
	const out = new Map<string, { attempts: number; alone: number }>();
	for (const e of entries) {
		if (category && e.category !== category) continue;
		for (const a of e.attempts) {
			const t = Date.parse(a.at);
			if (!Number.isFinite(t)) continue;
			const day = localDay(t);
			const d = out.get(day) ?? { attempts: 0, alone: 0 };
			d.attempts++;
			if (a.outcome === "clean" || a.outcome === "slow") d.alone++;
			out.set(day, d);
		}
	}
	return out;
}

export function isOutcome(v: unknown): v is Outcome {
	return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

/**
 * Why a stored log can't be read safely (the store moves such a file aside
 * instead of overwriting it), or null. Entries that would be dropped count:
 * writing the parsed log back would lose them.
 */
export function problemLogProblem(raw: unknown): string | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "not an object";
	const r = raw as Record<string, unknown>;
	if (r.version !== 1) return `unknown version ${String(r.version)}`;
	if (r.entries !== undefined && !Array.isArray(r.entries)) return "entries is not a list";
	if (r.categories !== undefined && !Array.isArray(r.categories)) return "categories is not a list";
	const kept = parseProblemLog(raw);
	const entries = (r.entries as unknown[] | undefined) ?? [];
	if (kept.entries.length !== entries.length) return `${entries.length - kept.entries.length} malformed entries`;
	const attempts = (e: unknown) => (e && typeof e === "object" && Array.isArray((e as { attempts?: unknown }).attempts) ? (e as { attempts: unknown[] }).attempts.length : 0);
	if (kept.entries.reduce((n, e) => n + e.attempts.length, 0) !== entries.reduce((n: number, e) => n + attempts(e), 0)) return "malformed attempts";
	return null;
}

/** Read an unknown JSON value as a log, dropping what's malformed. */
export function parseProblemLog(raw: unknown): ProblemLog {
	const out = emptyProblemLog();
	if (!raw || typeof raw !== "object") return out;
	const r = raw as Partial<ProblemLog>;
	if (Array.isArray(r.categories)) {
		const cats = r.categories.filter((c): c is ProblemCategory => !!c && typeof c.id === "string" && typeof c.label === "string" && !!c.id && !!c.label);
		if (cats.length) out.categories = cats;
	}
	if (r.courseCategory && typeof r.courseCategory === "object") {
		for (const [k, v] of Object.entries(r.courseCategory)) if (typeof v === "string") out.courseCategory[k] = v;
	}
	if (Array.isArray(r.entries)) {
		for (const e of r.entries) {
			if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.reference !== "string" || typeof e.source !== "string") continue;
			const attempts = Array.isArray(e.attempts) ? e.attempts.filter((a) => a && typeof a.at === "string" && isOutcome(a.outcome)) : [];
			out.entries.push({ ...e, category: typeof e.category === "string" ? e.category : "skola", attempts });
		}
	}
	return out;
}
