/**
 * Side chats (fork, 2026-11-08) — the server side. A side question is answered
 * by its own agent run (teacher-slot model, no tools) with the session as
 * read-only context: the plan outline and the recent lesson, with the open
 * question's answer key removed. It runs on its own, in parallel with the
 * lesson. Threads are stored in ChatRecord.sideThreads, never in `messages`.
 */
import { runSubagent } from "../agent/subagents/pi-run.ts";
import {
	derivePlanStatusesLh,
	emit,
	openQuestionSummary,
	planOutline,
	redactOpenQuestion,
	sessionMarkdown,
	sideThreadTitle,
	toSerbianLatin,
	type ChatRecord,
	type SideMessage,
	type SideThread,
} from "../core";
import { resolveEngine } from "./chat-handler.ts";
import { addNoteExtra } from "./notes.ts";
import { stores } from "./stores.ts";

const MAX_LESSON_CHARS = 40_000;
const MAX_QUESTION_CHARS = 4_000;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

const SIDE_SYSTEM = `You answer a student's side question during a lesson in a tutoring app. You are NOT the teacher of the lesson and you never change its plan.
You see the lesson so far (read-only) for context. Answer the side question directly and correctly, in Serbian, Latin script only, unless the student writes in another language and asks for it.
Be concise: a short direct answer first, then only the detail that helps. Use Markdown; code in fenced blocks.
If the question is about the exercise the student is answering right now, do not give away its answer — explain the idea or give a hint instead.
If the question is unrelated to the course, still answer it helpfully.`;

const newId = (p: string) => `${p}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;

function lessonContext(chat: ChatRecord): string {
	let lesson = sessionMarkdown(redactOpenQuestion(chat.messages), { anchors: false });
	if (lesson.length > MAX_LESSON_CHARS) lesson = `…\n${lesson.slice(-MAX_LESSON_CHARS)}`;
	return lesson;
}

function threadPrompt(chat: ChatRecord, thread: SideThread): string {
	const history = thread.messages
		.filter((m) => !m.pending && !m.error)
		.map((m) => `${m.role === "user" ? "Student" : "You"}: ${m.quote ? `[about this part of the lesson: "${m.quote}"]\n` : ""}${m.text}`)
		.join("\n\n");
	const open = openQuestionSummary(chat.messages);
	return [
		`Course: ${toSerbianLatin(chat.title)}`,
		`Plan:\n${planOutline(chat.tree)}`,
		`The lesson so far (read-only):\n<<<\n${lessonContext(chat)}\n>>>`,
		open
			? `The question the student is answering in the lesson RIGHT NOW (its answer is hidden from you on purpose — never give its answer; explain ideas or hint instead):\n<<<\n${open}\n>>>`
			: "",
		`The side conversation (answer the student's last message):\n\n${history}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

function setThread(chatId: string, threadId: string, change: (t: SideThread) => void) {
	stores.chatStore.updateSideThreads(chatId, (threads) => {
		const t = threads.find((x) => x.id === threadId);
		if (t) change(t);
	});
	emit("record-changed", { chatId });
}

/** Answers being written by this process (a pending one not in here was cut
 *  off by a restart and will never finish). */
const running = new Set<string>();

/** Mark pending answers whose work died with a restart as failed. */
export function healSidePending(chatId: string): void {
	const chat = stores.chatStore.getChat(chatId);
	const stale = (chat?.sideThreads ?? []).some((t) => t.messages.some((m) => m.pending && !running.has(m.id)));
	if (!stale) return;
	stores.chatStore.updateSideThreads(chatId, (threads) => {
		for (const t of threads)
			for (const m of t.messages)
				if (m.pending && !running.has(m.id)) {
					delete m.pending;
					m.error = "Prekinuto — aplikacija je ponovo pokrenuta. Pitaj ponovo.";
				}
	});
}

async function answer(chatId: string, threadId: string, answerId: string) {
	running.add(answerId);
	try {
		const chat = stores.chatStore.getChat(chatId);
		const thread = chat?.sideThreads?.find((t) => t.id === threadId);
		if (!chat || !thread) return;
		const engine = resolveEngine("teacher");
		if (!engine) throw new Error("Nije podešen model (Settings → Providers).");
		const { text } = await runSubagent([], { role: "teacher", engine, systemPrompt: SIDE_SYSTEM, prompt: threadPrompt(chat, thread), maxTurns: 1, chatId });
		if (!text.trim()) throw new Error("Prazan odgovor.");
		setThread(chatId, threadId, (t) => {
			const m = t.messages.find((x) => x.id === answerId);
			if (m) {
				m.text = text.trim();
				delete m.pending;
			}
		});
	} catch (e) {
		setThread(chatId, threadId, (t) => {
			const m = t.messages.find((x) => x.id === answerId);
			if (m) {
				delete m.pending;
				m.error = e instanceof Error ? e.message : String(e);
			}
		});
	} finally {
		running.delete(answerId);
	}
}

/** Ask (a new thread when `threadId` is absent). Returns the thread id at once;
 *  the answer lands in the record when ready (record-changed). */
export function askSideQuestion(chatId: string, input: { threadId?: string; text: string; quote?: string }): { threadId: string } | string {
	healSidePending(chatId);
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return "Not found";
	const text = input.text.trim().slice(0, MAX_QUESTION_CHARS);
	if (!text) return "Empty question";
	const now = new Date().toISOString();
	const user: SideMessage = { id: newId("sm"), role: "user", text, at: now, ...(input.quote ? { quote: input.quote.slice(0, 2_000) } : {}) };
	const pending: SideMessage = { id: newId("sm"), role: "assistant", text: "", at: now, pending: true };
	let threadId = input.threadId;
	let busy = false;
	stores.chatStore.updateSideThreads(chatId, (threads) => {
		const existing = threadId ? threads.find((t) => t.id === threadId) : undefined;
		if (threadId && !existing) {
			threadId = undefined;
		}
		if (existing) {
			if (existing.messages.some((m) => m.pending)) {
				busy = true;
				return;
			}
			existing.messages.push(user, pending);
			delete existing.closed;
		} else {
			const nodeId = chat.tree ? (derivePlanStatusesLh(chat.tree, chat.messages).current ?? undefined) : undefined;
			threadId = newId("st");
			threads.push({ id: threadId, title: sideThreadTitle(text), createdAt: now, ...(nodeId ? { nodeId } : {}), messages: [user, pending] });
		}
	});
	if (busy) return "Sačekaj odgovor na prethodno pitanje.";
	emit("record-changed", { chatId });
	void answer(chatId, threadId!, pending.id);
	return { threadId: threadId! };
}

export type SideAction =
	| { op: "ask"; threadId?: string; text: string; quote?: string }
	| { op: "close" | "reopen" | "delete"; threadId: string }
	| { op: "save-notes" | "make-card"; threadId: string; messageId: string };

export function parseSideAction(body: unknown): SideAction | string {
	if (!body || typeof body !== "object") return "Body must be an object";
	const b = body as Record<string, unknown>;
	const str = (v: unknown) => typeof v === "string" && v.length > 0 && !RESERVED.has(v);
	if (b.op === "ask") {
		if (typeof b.text !== "string" || !b.text.trim()) return "ask needs { text }";
		if (b.threadId !== undefined && !str(b.threadId)) return "bad threadId";
		if (b.quote !== undefined && typeof b.quote !== "string") return "quote must be a string";
		return { op: "ask", text: b.text, ...(b.threadId ? { threadId: b.threadId as string } : {}), ...(b.quote ? { quote: b.quote as string } : {}) };
	}
	if (b.op === "close" || b.op === "reopen" || b.op === "delete") {
		if (!str(b.threadId)) return `${b.op} needs { threadId }`;
		return { op: b.op, threadId: b.threadId as string };
	}
	if (b.op === "save-notes" || b.op === "make-card") {
		if (!str(b.threadId) || !str(b.messageId)) return `${b.op} needs { threadId, messageId }`;
		return { op: b.op, threadId: b.threadId as string, messageId: b.messageId as string };
	}
	return "op must be ask | close | reopen | delete | save-notes | make-card";
}

/** The question that led to an answer (the user message right before it). */
function questionFor(thread: SideThread, messageId: string): { question: SideMessage; answer: SideMessage } | null {
	const i = thread.messages.findIndex((m) => m.id === messageId);
	const answer = thread.messages[i];
	if (i < 1 || !answer || answer.role !== "assistant" || answer.pending || answer.error) return null;
	for (let j = i - 1; j >= 0; j--) if (thread.messages[j]!.role === "user") return { question: thread.messages[j]!, answer };
	return null;
}

/** The plan step a saved answer belongs to: the thread's, else the current one, else the first. */
function stepFor(chat: ChatRecord, thread: SideThread): string | null {
	const ids = new Set((chat.tree?.nodes ?? []).map((n) => n.id));
	if (thread.nodeId && ids.has(thread.nodeId)) return thread.nodeId;
	const current = chat.tree ? derivePlanStatusesLh(chat.tree, chat.messages).current : null;
	return current ?? chat.tree?.nodes[0]?.id ?? null;
}

export function applySideAction(chatId: string, action: SideAction): { ok: true; threadId?: string } | { ok: false; error: string; status: number } {
	if (action.op === "ask") {
		const r = askSideQuestion(chatId, action);
		return typeof r === "string" ? { ok: false, error: r, status: r === "Not found" ? 404 : 409 } : { ok: true, threadId: r.threadId };
	}
	const chat = stores.chatStore.getChat(chatId);
	const thread = chat?.sideThreads?.find((t) => t.id === action.threadId);
	if (!chat || !thread) return { ok: false, error: "Unknown thread", status: 404 };
	if (action.op === "close" || action.op === "reopen") {
		setThread(chatId, thread.id, (t) => {
			if (action.op === "close") t.closed = true;
			else delete t.closed;
		});
		return { ok: true };
	}
	if (action.op === "delete") {
		stores.chatStore.updateSideThreads(chatId, (threads) => {
			const i = threads.findIndex((t) => t.id === thread.id);
			if (i >= 0) threads.splice(i, 1);
		});
		emit("record-changed", { chatId });
		return { ok: true };
	}
	if (action.op !== "save-notes" && action.op !== "make-card") return { ok: false, error: "bad op", status: 400 };
	const messageId = action.messageId;
	const qa = questionFor(thread, messageId);
	if (!qa) return { ok: false, error: "No finished answer with that id", status: 404 };
	const step = stepFor(chat, thread);
	if (!step) return { ok: false, error: "Kurs još nema plan.", status: 409 };
	if (action.op === "save-notes") {
		addNoteExtra(chatId, step, { title: sideThreadTitle(qa.question.text), markdown: `**${qa.question.text}**\n\n${qa.answer.text}` });
		setThread(chatId, thread.id, (t) => {
			const m = t.messages.find((x) => x.id === messageId);
			if (m) m.savedToNotes = true;
		});
		return { ok: true };
	}
	// make-card: a free-recall card — the question and this answer as the key.
	const cardId = `g_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
	stores.chatStore.updateCards(chatId, (c) => {
		(c.generated ??= []).push({
			id: cardId,
			tool: "explain",
			nodeId: step,
			args: { type: "check", nodeId: step, question: qa.question.text, correctAnswer: qa.answer.text },
			createdAt: new Date().toISOString(),
		});
	});
	setThread(chatId, thread.id, (t) => {
		const m = t.messages.find((x) => x.id === messageId);
		if (m) m.cardId = cardId;
	});
	return { ok: true };
}
