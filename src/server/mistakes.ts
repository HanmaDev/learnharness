/**
 * Mistake log (fork, 2026-11-08) — the server side: after each turn, wrong
 * app-graded answers without an analysis are analysed in the background by
 * the cheap model (up to 8 per call), and the learner's actions (resolve,
 * reopen, make a card) are applied.
 */
import { Type, type Static } from "typebox";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import {
	emit,
	mistakeViews,
	toSerbianLatin,
	unanalysed,
	type ChatRecord,
	type MistakeType,
	type MistakeView,
	type WrongAnswer,
} from "../core";
import { resolveEngine } from "./chat-handler.ts";
import { stores } from "./stores.ts";

const BATCH = 8;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

const analysisSchema = Type.Object({
	mistakes: Type.Array(
		Type.Object({
			id: Type.String({ description: "The mistake id you were given." }),
			type: Type.Union([Type.Literal("pojam"), Type.Literal("racun"), Type.Literal("nepaznja"), Type.Literal("citanje"), Type.Literal("predznanje"), Type.Literal("drugo")], {
				description: "pojam = misunderstood concept; racun = calculation slip; nepaznja = careless; citanje = misread the question; predznanje = missing prerequisite; drugo = other.",
			}),
			whatWentWrong: Type.String({ description: "1-2 sentences: what exactly the learner got wrong and why, from their answer." }),
			correctVersion: Type.String({ description: "The correct answer or approach, short." }),
			rule: Type.String({ description: "ONE rule to remember that prevents this mistake, one sentence." }),
		}),
	),
});
type AnalysisSubmit = Static<typeof analysisSchema>;

const SYSTEM = `You analyse a student's wrong answers in a tutoring app, so they can learn from each mistake.
For every mistake you get the question (with its answer key), the student's answer and the teacher's feedback.
Write in Serbian, Latin script only. Be specific to THIS answer, short and concrete. Never invent facts beyond the answer key and feedback. Submit all of them with submit_mistakes.`;

const clip = (v: unknown, n: number) => {
	const t = typeof v === "string" ? v : JSON.stringify(v ?? "");
	return t.length > n ? `${t.slice(0, n)}…` : t;
};

function describe(w: WrongAnswer, chat: ChatRecord): string {
	const node = chat.tree?.nodes.find((n) => n.id === w.nodeId);
	const { question, ...key } = w.args;
	return [
		`### Mistake id: ${w.callId}`,
		`Step: ${node ? toSerbianLatin(node.title) : (w.nodeId ?? "?")}`,
		`Question (${w.tool}): ${clip(question, 1_500)}`,
		`Answer key / question data: ${clip(key, 2_000)}`,
		`Student's answer (graded wrong): ${clip(w.answer, 1_500)}`,
		w.feedback ? `Teacher's feedback right after: ${clip(w.feedback, 1_500)}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** After a turn: analyse new wrong answers soon (debounced, one run per chat). */
export function scheduleMistakes(chatId: string, delayMs = 5_000): void {
	clearTimeout(timers.get(chatId));
	timers.set(
		chatId,
		setTimeout(() => {
			timers.delete(chatId);
			void analyseMistakes(chatId);
		}, delayMs),
	);
}

export async function analyseMistakes(chatId: string): Promise<void> {
	if (running.has(chatId)) return;
	running.add(chatId);
	try {
		await analyseRounds(chatId);
	} catch (e) {
		// e.g. the course was deleted mid-run: never an unhandled rejection.
		console.warn(`[mistakes] ${chatId}: ${e instanceof Error ? e.message : e}`);
	} finally {
		running.delete(chatId);
	}
}

/** Up to 3 batches (24 mistakes) per run; a long history fills in over turns. */
async function analyseRounds(chatId: string): Promise<void> {
	{
		for (let round = 0; round < 3; round++) {
			const chat = stores.chatStore.getChat(chatId);
			if (!chat || chat.kind === "practice") return;
			const todo = unanalysed(chat.messages, chat.mistakes).slice(0, BATCH);
			if (!todo.length) return;
			const engine = resolveEngine("extractor");
			if (!engine) return;
			const ids = new Set(todo.map((w) => w.callId));
			let out: AnalysisSubmit;
			try {
				// Background admission happens inside runSubagent (v0.6.0).
				out = await runSubmitAgent<AnalysisSubmit>({
						role: "extractor",
						chatId,
						toolName: "submit_mistakes",
						toolDescription: `Submit the analysis of all ${todo.length} mistakes.`,
						parameters: analysisSchema,
						fill: (input) => input as AnalysisSubmit,
						systemPrompt: SYSTEM,
						prompt: todo.map((w) => describe(w, chat)).join("\n\n"),
						engine,
						signal: undefined,
						onStep: () => {},
						neverSubmitted: "the mistake analyser never submitted",
						validate: (v) => (v.mistakes.every((m) => ids.has(m.id)) ? null : "use exactly the mistake ids you were given"),
					});
			} catch (e) {
				console.warn(`[mistakes] ${chatId}: ${e instanceof Error ? e.message : e}`);
				stores.chatStore.updateMistakes(chatId, (ms) => {
					for (const w of todo) {
						const s = (ms[w.callId] ??= {});
						s.failures = (s.failures ?? 0) + 1;
					}
				});
				emit("record-changed", { chatId });
				// A transient failure (rate limit, network): stop this run; the
				// next turn retries — never burn all retries in one go.
				return;
			}
			const now = new Date().toISOString();
			stores.chatStore.updateMistakes(chatId, (ms) => {
				const got = new Set<string>();
				for (const m of out.mistakes) {
					if (!ids.has(m.id) || RESERVED.has(m.id)) continue;
					got.add(m.id);
					(ms[m.id] ??= {}).analysis = {
						type: m.type as MistakeType,
						whatWentWrong: toSerbianLatin(m.whatWentWrong.trim()),
						correctVersion: toSerbianLatin(m.correctVersion.trim()),
						rule: toSerbianLatin(m.rule.trim()),
						at: now,
					};
				}
				for (const w of todo) if (!got.has(w.callId)) ((ms[w.callId] ??= {}).failures = ((ms[w.callId]?.failures ?? 0) + 1));
			});
			emit("record-changed", { chatId });
		}
	}
}

export interface CourseMistakesView {
	chatId: string;
	mistakes: MistakeView[];
	analysing: boolean;
}

export function mistakesView(chat: ChatRecord): CourseMistakesView {
	return { chatId: chat.id, mistakes: mistakeViews(chat.messages, chat.mistakes, chat.tree), analysing: running.has(chat.id) || timers.has(chat.id) };
}

export type MistakeAction = { op: "resolve" | "reopen" | "make-card"; callId: string } | { op: "analyse" };

export function parseMistakeAction(body: unknown): MistakeAction | string {
	const b = (body ?? {}) as Record<string, unknown>;
	if (b.op === "analyse") return { op: "analyse" };
	if ((b.op === "resolve" || b.op === "reopen" || b.op === "make-card") && typeof b.callId === "string" && b.callId && !RESERVED.has(b.callId)) return { op: b.op, callId: b.callId };
	return "op must be resolve | reopen | make-card (with callId) or analyse";
}

export function applyMistakeAction(chatId: string, action: MistakeAction): string | null {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return "Not found";
	if (action.op === "analyse") {
		// Retry the ones that failed before, too.
		stores.chatStore.updateMistakes(chatId, (ms) => {
			for (const s of Object.values(ms)) if (!s.analysis) delete s.failures;
		});
		void analyseMistakes(chatId);
		return null;
	}
	const view = mistakeViews(chat.messages, chat.mistakes, chat.tree).find((v) => v.callId === action.callId);
	if (!view) return "Unknown mistake";
	if (action.op === "make-card") {
		if (!view.analysis || !view.nodeId) return "Greška još nije analizirana ili nema korak.";
		if (view.cardId) return null;
		const cardId = `g_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
		stores.chatStore.updateCards(chatId, (c) => {
			(c.generated ??= []).push({
				id: cardId,
				tool: "explain",
				nodeId: view.nodeId!,
				args: {
					type: "check",
					nodeId: view.nodeId,
					question: `${view.question}\n\n_(Ranije greška: ${view.analysis!.whatWentWrong})_`,
					correctAnswer: `${view.analysis!.correctVersion}\n\n**Pravilo:** ${view.analysis!.rule}`,
				},
				createdAt: new Date().toISOString(),
			});
		});
		stores.chatStore.updateMistakes(chatId, (ms) => ((ms[action.callId] ??= {}).cardId = cardId));
	} else {
		stores.chatStore.updateMistakes(chatId, (ms) => ((ms[action.callId] ??= {}).resolved = action.op === "resolve"));
	}
	emit("record-changed", { chatId });
	return null;
}
