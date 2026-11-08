/**
 * Problem log (fork, 2026-11-08) — the server side: the learner's actions on
 * the Zadaci page and the teacher's `log_problem` tool.
 */
import {
	BRANCHES,
	defaultCategory,
	emit,
	isOutcome,
	problemKey,
	type Outcome,
	type ProblemEntry,
	type ProblemLog,
} from "../core";
import { readProblemLog, updateProblemLog } from "../store/problems.ts";

const newId = (p: string) => `${p}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function problemLog(): ProblemLog {
	return readProblemLog();
}

function changed() {
	emit("record-changed", { chatId: "problems" });
}

export interface AttemptInput {
	category?: string;
	source: string;
	reference: string;
	branch?: string;
	trackerId?: string;
	outcome: Outcome;
	minutes?: number;
	note?: string;
	at?: string;
	chatId?: string;
}

/** Add an attempt — to the existing entry for the same source+reference, or a new one. */
export function logAttempt(input: AttemptInput): { entry: ProblemEntry; created: boolean } {
	const result = updateProblemLog((log) => {
		const key = problemKey(input.source, input.reference);
		let entry = log.entries.find((e) => (input.trackerId && e.trackerId === input.trackerId) || problemKey(e.source, e.reference) === key);
		const created = !entry;
		if (!entry) {
			const category = input.category && log.categories.some((c) => c.id === input.category) ? input.category : defaultCategory(log, input.source, input.chatId);
			entry = {
				id: newId("pr"),
				category,
				source: input.source,
				reference: input.reference,
				...(input.branch ? { branch: input.branch } : {}),
				...(input.chatId ? { chatId: input.chatId } : {}),
				...(input.trackerId ? { trackerId: input.trackerId } : {}),
				attempts: [],
				createdAt: new Date().toISOString(),
			};
			log.entries.push(entry);
		} else if (input.branch && !entry.branch) entry.branch = input.branch;
		entry.attempts.push({
			id: newId("at"),
			at: input.at && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : new Date().toISOString(),
			outcome: input.outcome,
			...(input.minutes !== undefined && Number.isFinite(input.minutes) && input.minutes >= 0 ? { minutes: Math.round(input.minutes) } : {}),
			...(input.note ? { note: input.note } : {}),
			...(input.chatId ? { chatId: input.chatId } : {}),
		});
		// A new attempt re-derives the schedule from its outcome.
		delete entry.resolveOn;
		return { entry: structuredClone(entry), created };
	});
	changed();
	return result;
}

export type ProblemAction =
	| { op: "attempt"; input: AttemptInput }
	| { op: "update"; id: string; category?: string; source?: string; reference?: string; branch?: string | null; note?: string | null }
	| { op: "schedule"; id: string; on: string | null | "auto" }
	| { op: "delete"; id: string }
	| { op: "delete-attempt"; id: string; attemptId: string }
	| { op: "add-category"; label: string }
	| { op: "rename-category"; categoryId: string; label: string }
	| { op: "delete-category"; categoryId: string; moveTo: string }
	| { op: "course-category"; chatId: string; categoryId: string | null };

export function parseAttemptInput(b: Record<string, unknown>): AttemptInput | string {
	const source = str(b.source, 120);
	const reference = str(b.reference, 200);
	if (!source || !reference) return "source and reference are required";
	if (!isOutcome(b.outcome)) return "outcome must be clean | slow | hint | read | unsolved";
	const minutes = b.minutes === undefined || b.minutes === null || b.minutes === "" ? undefined : Number(b.minutes);
	if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0 || minutes > 24 * 60)) return "minutes must be 0-1440";
	return {
		source,
		reference,
		outcome: b.outcome,
		...(str(b.category, 60) ? { category: str(b.category, 60) } : {}),
		...(str(b.branch, 60) ? { branch: str(b.branch, 60) } : {}),
		...(str(b.trackerId, 80) ? { trackerId: str(b.trackerId, 80) } : {}),
		...(minutes !== undefined ? { minutes } : {}),
		...(str(b.note, 1_000) ? { note: str(b.note, 1_000) } : {}),
		...(typeof b.at === "string" ? { at: b.at } : {}),
	};
}

export function parseProblemAction(body: unknown): ProblemAction | string {
	if (!body || typeof body !== "object") return "Body must be an object";
	const b = body as Record<string, unknown>;
	const id = (k: string) => (typeof b[k] === "string" && b[k] && !RESERVED.has(b[k] as string) ? (b[k] as string) : null);
	switch (b.op) {
		case "attempt": {
			const input = parseAttemptInput((b.input ?? {}) as Record<string, unknown>);
			return typeof input === "string" ? input : { op: "attempt", input };
		}
		case "update": {
			if (!id("id")) return "update needs { id }";
			return {
				op: "update",
				id: id("id")!,
				...(str(b.category, 60) ? { category: str(b.category, 60) } : {}),
				...(str(b.source, 120) ? { source: str(b.source, 120) } : {}),
				...(str(b.reference, 200) ? { reference: str(b.reference, 200) } : {}),
				...(b.branch === null ? { branch: null } : str(b.branch, 60) ? { branch: str(b.branch, 60) } : {}),
				...(b.note === null ? { note: null } : typeof b.note === "string" ? { note: b.note.slice(0, 1_000) } : {}),
			};
		}
		case "schedule":
			if (!id("id") || !(b.on === null || b.on === "auto" || isDate(b.on))) return 'schedule needs { id, on: "YYYY-MM-DD" | null | "auto" }';
			return { op: "schedule", id: id("id")!, on: b.on as string | null };
		case "delete":
			return id("id") ? { op: "delete", id: id("id")! } : "delete needs { id }";
		case "delete-attempt":
			return id("id") && id("attemptId") ? { op: "delete-attempt", id: id("id")!, attemptId: id("attemptId")! } : "delete-attempt needs { id, attemptId }";
		case "add-category":
			return str(b.label, 60) ? { op: "add-category", label: str(b.label, 60)! } : "add-category needs { label }";
		case "rename-category":
			return id("categoryId") && str(b.label, 60) ? { op: "rename-category", categoryId: id("categoryId")!, label: str(b.label, 60)! } : "rename-category needs { categoryId, label }";
		case "delete-category":
			return id("categoryId") && id("moveTo") ? { op: "delete-category", categoryId: id("categoryId")!, moveTo: id("moveTo")! } : "delete-category needs { categoryId, moveTo }";
		case "course-category":
			if (!id("chatId") || !(b.categoryId === null || id("categoryId"))) return "course-category needs { chatId, categoryId | null }";
			return { op: "course-category", chatId: id("chatId")!, categoryId: (b.categoryId as string | null) ?? null };
		default:
			return "unknown op";
	}
}

const slug = (label: string) =>
	label
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40) || "kategorija";

export function applyProblemAction(action: ProblemAction): string | null {
	if (action.op === "attempt") {
		logAttempt(action.input);
		return null;
	}
	const error = updateProblemLog((log): string | null => {
		const entry = "id" in action ? log.entries.find((e) => e.id === action.id) : undefined;
		const validCat = (c: string) => log.categories.some((x) => x.id === c);
		switch (action.op) {
			case "update":
				if (!entry) return "Unknown problem";
				if (action.category) {
					if (!validCat(action.category)) return "Unknown category";
					entry.category = action.category;
				}
				if (action.source) entry.source = action.source;
				if (action.reference) entry.reference = action.reference;
				if (action.branch === null) delete entry.branch;
				else if (action.branch) entry.branch = action.branch;
				if (action.note === null || action.note === "") delete entry.note;
				else if (action.note !== undefined) entry.note = action.note;
				return null;
			case "schedule":
				if (!entry) return "Unknown problem";
				if (action.on === "auto") delete entry.resolveOn;
				else entry.resolveOn = action.on;
				return null;
			case "delete":
				if (!entry) return "Unknown problem";
				log.entries.splice(log.entries.indexOf(entry), 1);
				return null;
			case "delete-attempt": {
				if (!entry) return "Unknown problem";
				const i = entry.attempts.findIndex((a) => a.id === action.attemptId);
				if (i < 0) return "Unknown attempt";
				entry.attempts.splice(i, 1);
				return null;
			}
			case "add-category": {
				let cid = slug(action.label);
				for (let n = 2; validCat(cid); n++) cid = `${slug(action.label)}-${n}`;
				log.categories.push({ id: cid, label: action.label });
				return null;
			}
			case "rename-category": {
				const c = log.categories.find((x) => x.id === action.categoryId);
				if (!c) return "Unknown category";
				c.label = action.label;
				return null;
			}
			case "delete-category": {
				if (!validCat(action.categoryId) || !validCat(action.moveTo) || action.categoryId === action.moveTo) return "Pick another category to move its problems to";
				if (log.categories.length <= 1) return "At least one category must stay";
				for (const e of log.entries) if (e.category === action.categoryId) e.category = action.moveTo;
				for (const [k, v] of Object.entries(log.courseCategory)) if (v === action.categoryId) log.courseCategory[k] = action.moveTo;
				log.categories = log.categories.filter((x) => x.id !== action.categoryId);
				return null;
			}
			case "course-category":
				if (action.categoryId === null) delete log.courseCategory[action.chatId];
				else {
					if (!validCat(action.categoryId)) return "Unknown category";
					log.courseCategory[action.chatId] = action.categoryId;
				}
				return null;
		}
	});
	if (!error) changed();
	return error;
}

/** The categories as a line for the teacher's tool description. */
export function categoryHint(): string {
	const log = readProblemLog();
	return log.categories.map((c) => `${c.id} (${c.label})`).join(", ");
}

export { BRANCHES };
