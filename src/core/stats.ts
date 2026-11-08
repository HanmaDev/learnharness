/**
 * Learning statistics (fork, 2026-11-08): per-day activity from what the app
 * already stores — the learner's answers (with time and correctness), the
 * teacher's plan_progress done marks, card reviews, and the active study
 * time log (core/study-time.ts). Pure: no runtime deps.
 */
import type { CourseCards } from "./cards.ts";
import type { LhMessage } from "./native-messages.ts";
import type { StudyTimeLog } from "./study-time.ts";
import { localDate } from "./plan-progress.ts";

export interface DayStats {
	/** Active study seconds. */
	studySec: number;
	/** Plan steps finished (first time done). */
	steps: number;
	/** Questions answered (skipped ones don't count). */
	questions: number;
	/** Of those, the ones the app graded, and the correct ones. */
	graded: number;
	correct: number;
	/** Card reviews, and the ones recalled (rated above Ponovo). */
	reviews: number;
	recalled: number;
}

export const emptyDay = (): DayStats => ({ studySec: 0, steps: 0, questions: 0, graded: 0, correct: 0, reviews: 0, recalled: 0 });

export interface StatsCourseInput {
	id: string;
	messages: readonly LhMessage[];
	cards?: CourseCards;
}

const QUESTION_TOOLS = new Set(["quiz", "explain", "exercise", "probe", "recall"]);

function bump(days: Map<string, DayStats>, date: string, f: (d: DayStats) => void) {
	let d = days.get(date);
	if (!d) days.set(date, (d = emptyDay()));
	f(d);
}

/** Per-day activity for the given courses (all of them when `only` is null). */
export function dailyStats(courses: readonly StatsCourseInput[], study: StudyTimeLog, only: string | null = null): Map<string, DayStats> {
	const days = new Map<string, DayStats>();
	const picked = only ? courses.filter((c) => c.id === only) : courses;
	for (const c of picked) {
		const questionCalls = new Map<string, string>();
		const progressCalls: Array<{ id: string; done: string[]; reopen: string[]; at: number }> = [];
		const okResults = new Set<string>();
		for (const m of c.messages) {
			const r = m as { role?: string; content?: unknown; toolCallId?: string; toolName?: string; isError?: boolean; details?: unknown; timestamp?: number };
			if (r.role === "assistant" && Array.isArray(r.content)) {
				for (const b of r.content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
					if (b.type !== "toolCall" || !b.id) continue;
					if (QUESTION_TOOLS.has(b.name ?? "")) questionCalls.set(b.id, b.name!);
					if (b.name === "plan_progress") {
						const a = (b.arguments ?? {}) as { done?: unknown; reopen?: unknown };
						const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
						progressCalls.push({ id: b.id, done: list(a.done), reopen: list(a.reopen), at: r.timestamp ?? 0 });
					}
				}
			} else if (r.role === "toolResult" && typeof r.toolCallId === "string" && !r.isError) {
				okResults.add(r.toolCallId);
				if (!questionCalls.has(r.toolCallId)) continue;
				const d = (r.details ?? {}) as { answeredAt?: unknown; dismissed?: unknown; setAside?: unknown; correct?: unknown; dontKnow?: unknown; exercise?: { result?: { graded?: unknown; correct?: unknown } } };
				if (d.dismissed === true || d.setAside === true) continue;
				const at = typeof d.answeredAt === "string" ? Date.parse(d.answeredAt) : (r.timestamp ?? 0);
				if (!Number.isFinite(at) || at <= 0) continue;
				let correct: boolean | undefined = typeof d.correct === "boolean" ? d.correct : undefined;
				const ex = d.exercise?.result;
				if (correct === undefined && ex && ex.graded !== false && typeof ex.correct === "boolean") correct = ex.correct;
				if (d.dontKnow === true) correct = false;
				bump(days, localDate(at), (s) => {
					s.questions++;
					if (correct !== undefined) {
						s.graded++;
						if (correct) s.correct++;
					}
				});
			}
		}
		// Steps: the first time each one is marked done.
		const ever = new Set<string>();
		for (const p of progressCalls) {
			if (!okResults.has(p.id) || p.at <= 0) continue;
			for (const id of p.done) {
				if (ever.has(id)) continue;
				ever.add(id);
				bump(days, localDate(p.at), (s) => s.steps++);
			}
		}
		// Card reviews.
		for (const state of Object.values(c.cards?.states ?? {})) {
			for (const rv of state.reviews ?? []) {
				const at = Date.parse(rv.at);
				if (!Number.isFinite(at)) continue;
				bump(days, localDate(at), (s) => {
					s.reviews++;
					if (rv.rating > 1) s.recalled++;
				});
			}
		}
	}
	for (const [date, d] of Object.entries(study.days)) {
		const sec = only ? (d.chats[only] ?? 0) : d.total;
		if (sec > 0) bump(days, date, (s) => (s.studySec += sec));
	}
	return days;
}

export function sumDays(days: Map<string, DayStats>, dates: Iterable<string>): DayStats {
	const out = emptyDay();
	for (const date of dates) {
		const d = days.get(date);
		if (!d) continue;
		for (const k of Object.keys(out) as Array<keyof DayStats>) out[k] += d[k];
	}
	return out;
}

/** A day counts toward the streak with any real activity. */
export const activeDay = (d: DayStats | undefined) => !!d && (d.studySec >= 60 || d.questions > 0 || d.reviews > 0 || d.steps > 0);

const addDays = (date: string, n: number) => {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	return localDate(new Date(y, m - 1, d + n).getTime());
};

/** The local dates of a range ending today. */
export function rangeDates(range: "today" | "week" | "month" | "all", now: number, days: Map<string, DayStats>): string[] {
	const today = localDate(now);
	if (range === "today") return [today];
	if (range === "all") return [...days.keys()];
	const d = new Date(now);
	// Week: Monday-based; month: the calendar month.
	const start =
		range === "week"
			? localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime())
			: localDate(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
	const out: string[] = [];
	for (let x = start; x <= today; x = addDays(x, 1)) out.push(x);
	return out;
}

export interface Streaks {
	current: number;
	longest: number;
	activeDays: number;
}

export function streaks(days: Map<string, DayStats>, now: number): Streaks {
	const active = [...days.entries()].filter(([, d]) => activeDay(d)).map(([k]) => k).sort();
	let longest = 0;
	let run = 0;
	let prev: string | null = null;
	for (const date of active) {
		run = prev && addDays(prev, 1) === date ? run + 1 : 1;
		longest = Math.max(longest, run);
		prev = date;
	}
	// Current: up to today, or up to yesterday if today has nothing yet.
	const set = new Set(active);
	let day = localDate(now);
	if (!set.has(day)) day = addDays(day, -1);
	let current = 0;
	while (set.has(day)) {
		current++;
		day = addDays(day, -1);
	}
	return { current, longest, activeDays: active.length };
}

/** The last `n` local dates ending today, oldest first. */
export function lastDates(now: number, n: number): string[] {
	const today = localDate(now);
	return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}

export interface StatsView {
	now: number;
	courses: Array<{ id: string; title: string }>;
	course: string | null;
	ranges: Record<"today" | "week" | "month" | "all", DayStats>;
	/** Last 30 days, oldest first. */
	last30: Array<{ date: string; stats: DayStats }>;
	/** 53 weeks × 7 days (Monday first), oldest first: study minutes and whether active. */
	year: Array<{ date: string; minutes: number; active: boolean }>;
	streaks: Streaks;
}

export function statsView(courses: ReadonlyArray<StatsCourseInput & { title: string }>, study: StudyTimeLog, now: number, only: string | null): StatsView {
	const days = dailyStats(courses, study, only);
	const ranges = {
		today: sumDays(days, rangeDates("today", now, days)),
		week: sumDays(days, rangeDates("week", now, days)),
		month: sumDays(days, rangeDates("month", now, days)),
		all: sumDays(days, rangeDates("all", now, days)),
	};
	const last30 = lastDates(now, 30).map((date) => ({ date, stats: days.get(date) ?? emptyDay() }));
	// The year grid ends with the current week (Monday-based columns).
	const d = new Date(now);
	const daysToSunday = (7 - ((d.getDay() + 6) % 7) - 1) % 7;
	const end = addDays(localDate(now), daysToSunday);
	const year: StatsView["year"] = [];
	for (let i = 53 * 7 - 1; i >= 0; i--) {
		const date = addDays(end, -i);
		const s = days.get(date);
		year.push({ date, minutes: Math.round((s?.studySec ?? 0) / 60), active: activeDay(s) });
	}
	return { now, courses: courses.map((c) => ({ id: c.id, title: c.title })), course: only, ranges, last30, year, streaks: streaks(days, now) };
}
