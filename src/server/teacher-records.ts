/**
 * Fork (2026-11-09): what a session's teacher can do to the learner's own
 * records when the learner asks — the problem log (list, reschedule,
 * delete, plan an unattempted problem) and the course's card deck (add
 * cards). docs/fork-plans/teacher-tools-plan.md.
 */
import { OUTCOME_LABELS, lastAttempt, resolveDate, toSerbianLatin, type ProblemEntry } from "../core";
import type { MakeCardInput, ProblemEditInput, ProblemListInput } from "../agent/tools/aids.ts";
import { draftProblem, toDraft } from "./card-generation.ts";
import { applyCardAction, cardSettings } from "./cards.ts";
import { applyProblemAction, planProblem, problemLog } from "./problems.ts";
import { stores } from "./stores.ts";

const MAX_LINES = 80;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const inCourse = (e: ProblemEntry, chatId: string) => e.chatId === chatId || e.attempts.some((a) => a.chatId === chatId);

function entryLine(e: ProblemEntry): string {
	const last = lastAttempt(e);
	const next = resolveDate(e);
	return [
		`- id ${e.id}`,
		`${e.reference} (${e.source})`,
		`category ${e.category}`,
		last ? `last: ${OUTCOME_LABELS[last.outcome]} on ${last.at.slice(0, 10)}` : "not attempted yet",
		`attempts: ${e.attempts.length}`,
		`next: ${next ?? "none"}${e.resolveOn !== undefined ? " (set by hand)" : ""}`,
	].join(" | ");
}

export function problemListText(chatId: string, f: ProblemListInput): string {
	const q = f.query?.trim().toLowerCase();
	const list = problemLog().entries.filter((e) => {
		if ((f.scope ?? "course") === "course" && !inCourse(e, chatId)) return false;
		if (f.category && e.category !== f.category) return false;
		if (f.scheduledOnly && !resolveDate(e)) return false;
		if (q && !`${e.reference} ${e.source} ${e.note ?? ""}`.toLowerCase().includes(q)) return false;
		return true;
	});
	if (!list.length) return (f.scope ?? "course") === "course" ? "No entries in this course match. Try scope \"all\"." : "No entries match.";
	const sorted = [...list].sort((a, b) => (resolveDate(a) ?? "9999").localeCompare(resolveDate(b) ?? "9999"));
	const lines = sorted.slice(0, MAX_LINES).map(entryLine);
	return `${list.length} entr${list.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}${list.length > MAX_LINES ? `\n… ${list.length - MAX_LINES} more — narrow the filter.` : ""}`;
}

export function problemEditFor(chatId: string, input: ProblemEditInput): string {
	if (input.action === "plan") {
		if (!input.source?.trim() || !input.reference?.trim()) return "plan needs source and reference.";
		if (!isDate(input.date)) return "plan needs date as YYYY-MM-DD.";
		const r = planProblem({
			source: input.source.trim(),
			reference: input.reference.trim(),
			on: input.date,
			chatId,
			...(input.category ? { category: input.category } : {}),
			...(input.branch ? { branch: input.branch } : {}),
			...(input.trackerId ? { trackerId: input.trackerId } : {}),
			...(input.note?.trim() ? { note: input.note.trim() } : {}),
		});
		if (typeof r === "string") return r;
		return `${r.created ? "Planned" : "Rescheduled the existing entry"} "${r.entry.reference}" (${r.entry.source}, category ${r.entry.category}) for ${input.date}.`;
	}
	if (!input.id) return `${input.action} needs the entry id (from problem_log_list).`;
	const entry = problemLog().entries.find((e) => e.id === input.id);
	if (!entry) return `No entry with id ${input.id}. Call problem_log_list for the current ids.`;
	const label = `"${entry.reference}" (${entry.source})`;
	let error: string | null;
	switch (input.action) {
		case "schedule":
			if (!isDate(input.date)) return "schedule needs date as YYYY-MM-DD.";
			error = applyProblemAction({ op: "schedule", id: entry.id, on: input.date });
			return error ?? `${label} will come back on ${input.date}.`;
		case "unschedule":
			error = applyProblemAction({ op: "schedule", id: entry.id, on: null });
			return error ?? `${label} is no longer scheduled for re-solving.`;
		case "auto":
			error = applyProblemAction({ op: "schedule", id: entry.id, on: "auto" });
			if (error) return error;
			return `${label} follows its last outcome again: next ${resolveDate(problemLog().entries.find((e) => e.id === entry.id) ?? entry) ?? "none"}.`;
		case "delete":
			error = applyProblemAction({ op: "delete", id: entry.id });
			return error ?? `Deleted ${label} and its ${entry.attempts.length} attempt${entry.attempts.length === 1 ? "" : "s"}.`;
	}
}

/** "id: title" per plan step, for make_cards' description. */
export function planStepsText(chatId: string): string {
	const chat = stores.chatStore.getChat(chatId);
	return (chat?.tree?.nodes ?? []).map((n) => `${n.id}: ${toSerbianLatin(n.title)}`).join("\n");
}

export function makeCardsFor(chatId: string, cards: MakeCardInput[]): string {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return "This course is gone.";
	const nodeIds = new Set((chat.tree?.nodes ?? []).map((n) => n.id));
	if (!nodeIds.size) return "This course has no plan steps yet, so cards can't be attached to a step. Make the plan first.";
	const drafts = cards.map((c) => ({ nodeId: c.nodeId, tool: "explain" as const, question: c.front.trim(), correctAnswer: c.back.trim() }));
	const problems = drafts.map((d, i) => [i + 1, draftProblem(d, nodeIds)] as const).filter(([, p]) => p);
	if (problems.length) return `No cards added. Fix: ${problems.map(([i, p]) => `card ${i}: ${p}`).join("; ")}.`;
	if (!applyCardAction(chat, { op: "add", drafts: drafts.map(toDraft) })) return "No cards added: the deck refused them.";
	const off = !cardSettings().enabled ? " Note: Kartice are switched off in Settings, so they won't come up until the learner turns them on." : chat.cards?.enabled === false ? " Note: this course's deck is switched off in Kartice." : "";
	return `Added ${drafts.length} card${drafts.length === 1 ? "" : "s"} to this course's deck (new, they come up in Kartice).${off}`;
}
