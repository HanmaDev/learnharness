/**
 * Active study time (fork, 2026-11-08). The window reports a heartbeat while
 * it is visible, focused and the learner has typed, clicked or scrolled in
 * the last IDLE_CUTOFF_MS; each heartbeat adds the seconds since the previous
 * one (capped) to that local day, split by course. Pure: no runtime deps.
 */

/** No input for this long = not studying. */
export const IDLE_CUTOFF_MS = 3 * 60_000;
/** How often the window reports. */
export const HEARTBEAT_MS = 30_000;
/** One heartbeat never adds more than this (a sleeping laptop, a stall). */
export const MAX_HEARTBEAT_SECONDS = 60;

export interface StudyDay {
	/** Seconds of active time that day. */
	total: number;
	/** Seconds per course (chat id); time outside any course is only in total. */
	chats: Record<string, number>;
}

export interface StudyTimeLog {
	version: 1;
	/** Local date YYYY-MM-DD → that day's time. */
	days: Record<string, StudyDay>;
}

export const emptyStudyLog = (): StudyTimeLog => ({ version: 1, days: {} });

/** Add one heartbeat (pure; returns a new log). */
export function addStudySeconds(log: StudyTimeLog, date: string, seconds: number, chatId: string | null): StudyTimeLog {
	const s = Math.max(0, Math.min(MAX_HEARTBEAT_SECONDS, Math.round(seconds)));
	if (s === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return log;
	const prev = Object.prototype.hasOwnProperty.call(log.days, date) ? log.days[date]! : { total: 0, chats: {} };
	const chats = { ...prev.chats };
	if (chatId && !["__proto__", "constructor", "prototype"].includes(chatId)) chats[chatId] = (chats[chatId] ?? 0) + s;
	return { ...log, days: { ...log.days, [date]: { total: prev.total + s, chats } } };
}

/** Read an unknown JSON value as a log, dropping anything malformed. */
export function parseStudyLog(raw: unknown): StudyTimeLog {
	const out = emptyStudyLog();
	const days = (raw as { days?: unknown } | null)?.days;
	if (!days || typeof days !== "object") return out;
	for (const [date, d] of Object.entries(days as Record<string, unknown>)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !d || typeof d !== "object") continue;
		const total = Number((d as { total?: unknown }).total);
		if (!Number.isFinite(total) || total < 0) continue;
		const chats: Record<string, number> = {};
		const rawChats = (d as { chats?: unknown }).chats;
		if (rawChats && typeof rawChats === "object") {
			for (const [id, v] of Object.entries(rawChats as Record<string, unknown>)) {
				const n = Number(v);
				if (Number.isFinite(n) && n > 0) chats[id] = n;
			}
		}
		out.days[date] = { total, chats };
	}
	return out;
}

/** The course a page belongs to: /chat/<id>, /cards/<id>, /notes/<id>. */
export function chatIdFromPath(pathname: string | null | undefined): string | null {
	const m = /^\/(?:chat|cards|notes)\/([^/?#]+)/.exec(pathname ?? "");
	if (!m || m[1] === "new") return null;
	try {
		return decodeURIComponent(m[1]!);
	} catch {
		return null;
	}
}
