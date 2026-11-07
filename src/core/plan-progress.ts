/**
 * Plan progress (fork, 2026-11-07): done marks, the target date, study time
 * and pace — the numbers the learner sees in the top bar and plan view.
 *
 * Upstream keeps the plan tree structure-only and derives position from the
 * transcript (contracts/plan.ts derivePlanStatuses). Done marks follow the
 * same discipline: they are DERIVED from the teacher's `plan_progress` calls
 * in the record, in order (done adds, reopen removes), never stored — so a
 * map rewrite keeps them (slugs are permanent) and ids that left the map are
 * simply ignored. The target date is the one stored field (ChatRecord
 * .planTarget): the learner can set it from the plan view, outside any turn.
 *
 * Pure: no runtime deps — safe on server, client, and in tests.
 */
import type { PlanTree } from "./contracts/plan.ts";
import type { LhMessage } from "./native-messages.ts";

/** A plan's target finish date (calendar day, the learner's local date). */
export interface PlanTarget {
	/** YYYY-MM-DD. */
	date: string;
	/** Who set it last: the teacher (plan_init) or the learner (plan view). */
	setBy: "teacher" | "learner";
	/** ISO time of the change — keys the one-time notice to the teacher. */
	at: string;
}

/** Gaps longer than this between messages are breaks, not study time. */
export const STUDY_GAP_MS = 15 * 60_000;
/** The time-left estimate appears only after this many MEASURED done steps. */
export const MIN_MEASURED_STEPS = 3;
const DAY_MS = 24 * 60 * 60_000;

export function isPlanDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number) as [number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

interface CallBlock {
	type?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}

/** Ids of tool calls whose result went through cleanly (not an error). */
function cleanCallIds(messages: readonly LhMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		const r = m as { role?: string; toolCallId?: string; isError?: boolean };
		if (r.role === "toolResult" && typeof r.toolCallId === "string" && !r.isError) ids.add(r.toolCallId);
	}
	return ids;
}

function* toolCalls(messages: readonly LhMessage[], name: string): Generator<{ id: string; args: Record<string, unknown>; timestamp: number }> {
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as CallBlock[]) {
			if (block.type !== "toolCall" || block.name !== name) continue;
			const args = block.arguments && typeof block.arguments === "object" ? (block.arguments as Record<string, unknown>) : {};
			yield { id: block.id ?? "", args, timestamp: (m as { timestamp?: number }).timestamp ?? 0 };
		}
	}
}

const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Done nodes: the teacher's plan_progress calls folded in order. */
export function deriveDoneNodes(tree: PlanTree, messages: readonly LhMessage[]): Set<string> {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const done = new Set<string>();
	// Only calls that went through: a rejected call (unknown id) moved nothing.
	const clean = cleanCallIds(messages);
	for (const { id, args } of toolCalls(messages, "plan_progress")) {
		if (!clean.has(id)) continue;
		for (const id of idList(args.done)) if (ids.has(id)) done.add(id);
		for (const id of idList(args.reopen)) done.delete(id);
	}
	return done;
}

/** Nodes actually TAUGHT in this record: at least one graded question
 *  (quiz / explain / exercise) was tagged with the node. A step marked done
 *  without any (e.g. a catch-up note after lost history) was not measured
 *  here, so it never enters the pace average. */
export function taughtNodes(messages: readonly LhMessage[]): Set<string> {
	const out = new Set<string>();
	for (const name of ["quiz", "explain", "exercise"]) {
		for (const { args } of toolCalls(messages, name)) if (typeof args.nodeId === "string") out.add(args.nodeId);
	}
	return out;
}

/** When studying the plan began: the first plan_init call's message time. */
export function planStartMs(messages: readonly LhMessage[]): number | null {
	for (const { timestamp } of toolCalls(messages, "plan_init")) if (timestamp > 0) return timestamp;
	return null;
}

/** Active study time since `since`: the sum of gaps between consecutive
 *  record messages, counting only gaps up to STUDY_GAP_MS. */
export function studyTimeMs(messages: readonly LhMessage[], since: number, now?: number): number {
	const times = messages
		.map((m) => (m as { timestamp?: number }).timestamp ?? 0)
		.filter((t) => t >= since && t > 0)
		.sort((a, b) => a - b);
	if (now !== undefined && times.length > 0 && now > times.at(-1)! && now - times.at(-1)! <= STUDY_GAP_MS) times.push(now);
	let total = 0;
	for (let i = 1; i < times.length; i++) {
		const gap = times[i]! - times[i - 1]!;
		if (gap <= STUDY_GAP_MS) total += gap;
	}
	return total;
}

/** Whole calendar days from `now`'s local date to the target date (0 = today). */
export function daysUntil(date: string, now: number): number {
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const target = new Date(y, m - 1, d).getTime();
	const today = new Date(now);
	const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
	return Math.round((target - start) / DAY_MS);
}

export interface PlanProgress {
	total: number;
	done: number;
	/** 0..100, rounded. */
	percent: number;
	doneIds: ReadonlySet<string>;
	studyMs: number;
	/** Average study time per MEASURED finished node; null until there are
	 *  MIN_MEASURED_STEPS of them. */
	perNodeMs: number | null;
	/** Estimated study time left; null until MIN_MEASURED_STEPS measured steps. */
	remainingMs: number | null;
	/** Done steps that were actually taught here (they drive the estimate). */
	measuredDone: number;
	target: PlanTarget | null;
	/** Calendar days until the target, counting today as a study day (>= 1
	 *  while the date is today or later); null without a target. Negative
	 *  once the date has passed. */
	daysLeft: number | null;
	/** Nodes per study day needed to finish by the target. */
	nodesPerDay: number | null;
	/** Study minutes per day needed to finish by the target. */
	minutesPerDayNeeded: number | null;
	/** Study minutes per day so far (since the plan started). */
	minutesPerDaySoFar: number | null;
	/** "on-track" | "behind" | "past" | "complete" | null (no target / no data). */
	pace: "on-track" | "behind" | "past" | "complete" | null;
}

export function computePlanProgress(input: {
	tree: PlanTree;
	messages: readonly LhMessage[];
	target?: PlanTarget | null;
	now: number;
}): PlanProgress {
	const { tree, messages, now } = input;
	const target = input.target && isPlanDate(input.target.date) ? input.target : null;
	const doneIds = deriveDoneNodes(tree, messages);
	const total = tree.nodes.length;
	const done = doneIds.size;
	const percent = total > 0 ? Math.round((done / total) * 100) : 0;
	const start = planStartMs(messages);
	const studyMs = start === null ? 0 : studyTimeMs(messages, start, now);
	// The pace counts only steps taught in this record (catch-up marks don't).
	const taught = taughtNodes(messages);
	const measuredDone = [...doneIds].filter((id) => taught.has(id)).length;
	const perNodeMs = measuredDone >= MIN_MEASURED_STEPS && studyMs > 0 ? studyMs / measuredDone : null;
	const left = total - done;
	const remainingMs = perNodeMs === null ? null : perNodeMs * left;

	let daysLeft: number | null = null;
	let nodesPerDay: number | null = null;
	let minutesPerDayNeeded: number | null = null;
	let pace: PlanProgress["pace"] = null;
	// Calendar days the plan has run, counting the start day (today − start + 1).
	const elapsedDays = start === null ? null : Math.max(1, daysUntil(localDate(now), start) + 1);
	const minutesPerDaySoFar = elapsedDays === null || studyMs === 0 ? null : studyMs / 60_000 / elapsedDays;
	if (target) {
		const until = daysUntil(target.date, now);
		daysLeft = until >= 0 ? until + 1 : until; // today counts as a study day
		if (left === 0 && total > 0) pace = "complete";
		else if (until < 0) pace = "past";
		else {
			nodesPerDay = left / daysLeft;
			if (remainingMs !== null) {
				minutesPerDayNeeded = remainingMs / 60_000 / daysLeft;
				if (minutesPerDaySoFar !== null) pace = minutesPerDaySoFar >= minutesPerDayNeeded ? "on-track" : "behind";
			}
		}
	} else if (left === 0 && total > 0) pace = "complete";

	return { total, done, percent, doneIds, studyMs, perNodeMs, remainingMs, measuredDone, target, daysLeft, nodesPerDay, minutesPerDayNeeded, minutesPerDaySoFar, pace };
}

/** `now` as the learner's local YYYY-MM-DD. */
export function localDate(now: number): string {
	const d = new Date(now);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2 h 10 min", "45 min", "< 1 min". */
export function formatStudyTime(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return "< 1 min";
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} min`;
	return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The teacher-facing one-paragraph status (plan_progress / plan_init results). */
export function planProgressText(p: PlanProgress): string {
	const parts = [`Done ${p.done}/${p.total} nodes (${p.percent}%).`, `Study time so far: ${formatStudyTime(p.studyMs)}.`];
	if (p.remainingMs !== null) parts.push(`Estimated study time left: ${formatStudyTime(p.remainingMs)} (at ${formatStudyTime(p.perNodeMs!)} per node).`);
	else if (p.pace !== "complete") parts.push(`No time estimate yet: it needs ${MIN_MEASURED_STEPS} steps finished with questions in this chat (${p.measuredDone} so far).`);
	if (p.target) {
		parts.push(`Target date: ${p.target.date} (set by the ${p.target.setBy}).`);
		if (p.pace === "past") parts.push("The target date has passed.");
		else if (p.pace === "complete") parts.push("Plan complete.");
		else if (p.daysLeft !== null) {
			let line = `${p.daysLeft} study day${p.daysLeft === 1 ? "" : "s"} left including today`;
			if (p.nodesPerDay !== null) line += `, ~${p.nodesPerDay.toFixed(1)} nodes/day needed`;
			if (p.minutesPerDayNeeded !== null) line += `, ~${Math.ceil(p.minutesPerDayNeeded)} min/day needed`;
			if (p.minutesPerDaySoFar !== null) line += ` (so far ~${Math.round(p.minutesPerDaySoFar)} min/day)`;
			parts.push(`${line}.`);
			if (p.pace === "behind") parts.push("Behind pace at the current rate.");
			if (p.pace === "on-track") parts.push("On track at the current rate.");
		}
	} else parts.push("No target date set.");
	return parts.join(" ");
}
