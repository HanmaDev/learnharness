/**
 * Fork (2026-11-11): keep a side answer. Side conversations are private (the
 * teacher never sees them); the learner can still save an answer into the
 * plan step's notes, or turn it into a Kartice card — the only ways a side
 * exchange leaves the side companion. Ported from the fork's own side panel
 * onto upstream's side threads (ChatRecord.sideChats).
 */
import { emit, type ChatRecord } from "../core";
import { addNoteExtra } from "./notes.ts";
import { stores } from "./stores.ts";

export type KeepOp = "notes" | "card";

/** The plan step a thread belongs to: the last question tagged up to its
 *  anchor message, else the plan's first step. */
export function sideThreadStep(chat: ChatRecord, anchorMessageId: string): string | null {
	const nodes = new Set((chat.tree?.nodes ?? []).map((n) => n.id));
	if (nodes.size === 0) return null;
	let step: string | null = null;
	for (const m of chat.messages) {
		if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const b of m.content as Array<{ type?: string; arguments?: { nodeId?: unknown } }>) {
				const nodeId = b.type === "toolCall" ? b.arguments?.nodeId : undefined;
				if (typeof nodeId === "string" && nodes.has(nodeId)) step = nodeId;
			}
		}
		if (m.id === anchorMessageId) break;
	}
	return step ?? chat.tree!.nodes[0]!.id;
}

const title = (q: string) => {
	const one = q.replace(/\s+/g, " ").trim();
	return one.length > 70 ? `${one.slice(0, 69)}…` : one || "Pitanje sa strane";
};

export function keepSideAnswer(chatId: string, threadId: string, messageId: string, op: KeepOp): { ok: true } | { ok: false; error: string; status: number } {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return { ok: false, error: "Unknown chat", status: 404 };
	const thread = (chat.sideChats ?? []).find((t) => t.id === threadId);
	if (!thread) return { ok: false, error: "Unknown side thread", status: 404 };
	const i = thread.messages.findIndex((m) => m.id === messageId);
	const answer = thread.messages[i];
	if (!answer || answer.role !== "assistant" || answer.error !== undefined || answer.stopped || answer.pending || !answer.text.trim()) {
		return { ok: false, error: "No finished answer with that id", status: 404 };
	}
	const question = thread.messages.slice(0, i).reverse().find((m) => m.role === "user");
	if (!question) return { ok: false, error: "That answer has no question", status: 409 };
	const step = sideThreadStep(chat, thread.anchor.messageId);
	if (!step) return { ok: false, error: "Kurs još nema plan.", status: 409 };
	const asked = [...(question.quotes ?? []).map((q) => `> ${q.replace(/\n/g, "\n> ")}`), question.text.trim()].filter(Boolean).join("\n\n");

	let cardId: string | undefined;
	if (op === "notes") {
		if (answer.savedToNotes) return { ok: true };
		addNoteExtra(chatId, step, { title: title(question.text), markdown: `**${question.text.trim()}**\n\n${answer.text.trim()}` });
	} else {
		if (answer.cardId) return { ok: true };
		cardId = `g_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
		const id = cardId;
		stores.chatStore.updateCards(chatId, (c) => {
			(c.generated ??= []).push({
				id,
				tool: "explain",
				nodeId: step,
				args: { type: "check", nodeId: step, question: asked, correctAnswer: answer.text.trim() },
				createdAt: new Date().toISOString(),
			});
		});
	}
	stores.chatStore.updateSideChats(chatId, (threads) =>
		threads.map((t) =>
			t.id !== threadId ? t : { ...t, messages: t.messages.map((m) => (m.id !== messageId ? m : op === "notes" ? { ...m, savedToNotes: true } : { ...m, cardId })) },
		),
	);
	emit("record-changed", { chatId });
	return { ok: true };
}
