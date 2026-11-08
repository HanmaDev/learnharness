/**
 * Side chats (fork, 2026-11-08): questions off the lesson's path, answered by
 * a separate agent that sees the session read-only. Threads live in
 * ChatRecord.sideThreads — never in `messages` — so the teacher, the graph
 * extraction, Kartice and the notes ignore them unless the learner saves an
 * answer on purpose. Design after upstream PR #451 (franco-g-s).
 *
 * Pure: no runtime deps.
 */
import type { PlanTree } from "./contracts/plan.ts";
import type { LhMessage } from "./native-messages.ts";

export interface SideMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	at: string;
	/** Teacher text the learner selected to ask about. */
	quote?: string;
	/** assistant: still being answered. */
	pending?: boolean;
	/** assistant: the answer failed. */
	error?: string;
	/** assistant: saved into the notes / turned into a card. */
	savedToNotes?: boolean;
	cardId?: string;
}

export interface SideThread {
	id: string;
	title: string;
	createdAt: string;
	closed?: boolean;
	/** The plan step being taught when the thread started (for notes/cards). */
	nodeId?: string;
	messages: SideMessage[];
}

/** A short thread title from the first question. */
export function sideThreadTitle(question: string): string {
	const t = question.replace(/\s+/g, " ").trim();
	return t.length > 40 ? `${t.slice(0, 38).trimEnd()}…` : t || "Pitanje";
}

const ANSWER_KEYS = new Set(["correctAnswer", "explanation", "accept", "acceptLatex", "answerLatex", "referenceSql", "mistakeLine", "pairs", "blanks"]);

/** The newest question call that has no answer yet — the learner may be in
 *  the middle of it, so its answer key must never reach the side agent. */
export function openQuestionCallId(messages: readonly LhMessage[]): string | null {
	const answered = new Set<string>();
	for (const m of messages) {
		const r = m as { role?: string; toolCallId?: string };
		if (r.role === "toolResult" && typeof r.toolCallId === "string") answered.add(r.toolCallId);
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		const content = (messages[i] as { role?: string; content?: unknown }).content;
		if ((messages[i] as { role?: string }).role !== "assistant" || !Array.isArray(content)) continue;
		for (const b of content as Array<{ type?: string; id?: string; name?: string }>) {
			if (b.type === "toolCall" && b.id && ["quiz", "explain", "exercise", "probe", "recall"].includes(b.name ?? "") && !answered.has(b.id)) return b.id;
		}
	}
	return null;
}

/** The transcript with the open question's answer key removed. */
export function redactOpenQuestion(messages: readonly LhMessage[]): LhMessage[] {
	const open = openQuestionCallId(messages);
	if (!open) return [...messages];
	return messages.map((m) => {
		const content = (m as { role?: string; content?: unknown }).content;
		if ((m as { role?: string }).role !== "assistant" || !Array.isArray(content)) return m;
		let changed = false;
		const next = (content as Array<Record<string, unknown>>).map((b) => {
			if (b.type !== "toolCall" || b.id !== open || !b.arguments || typeof b.arguments !== "object") return b;
			changed = true;
			const args = Object.fromEntries(Object.entries(b.arguments as Record<string, unknown>).filter(([k]) => !ANSWER_KEYS.has(k)));
			return { ...b, arguments: { ...args, note: "(the learner is answering this now — its answer key is hidden from you)" } };
		});
		return changed ? ({ ...(m as object), content: next } as unknown as LhMessage) : m;
	});
}

/** The plan as a short outline for the side agent. */
export function planOutline(tree: PlanTree | undefined): string {
	if (!tree) return "(no plan yet)";
	return tree.nodes.map((n, i) => `${i + 1}. ${n.title}${n.summary ? ` — ${n.summary}` : ""}`).join("\n");
}
