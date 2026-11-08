/**
 * Kartice (fork, 2026-11-08): "Nova pitanja" — the teacher-slot model writes
 * new cards for one plan step (or the weakest steps). Drafts come back to the
 * learner first; only the ones they keep are stored (op "add").
 */
import { Type, type Static } from "typebox";
import { runSubmitAgent } from "../agent/subagents/submit-agent.ts";
import type { PiEngine } from "../agent/models.ts";
import { buildCards, normalizeOptions, resolveCorrect, toSerbianLatin, type Card, type CardDraft, type ChatRecord, type GeneratedCard } from "../core";
import { cardSettings } from "./cards.ts";

export const MAX_GENERATE = 10;

const draftSchema = Type.Object({
	cards: Type.Array(
		Type.Object({
			nodeId: Type.String({ description: "The plan step id this card tests (one of the listed ids)." }),
			tool: Type.Union([Type.Literal("quiz"), Type.Literal("explain")], {
				description: "quiz = multiple choice (3-5 options, app-checked); explain = free recall, the learner compares with correctAnswer.",
			}),
			question: Type.String({ description: "Markdown. Code in fenced blocks." }),
			options: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.String() }), { description: "quiz only: 3-5 options, distinct values." })),
			correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
				description: "quiz: the correct option value(s). explain: the full model answer the learner compares against.",
			}),
			explanation: Type.Optional(Type.String({ description: "quiz: why the answer is right and the tempting wrong option is wrong." })),
		}),
	),
});
type DraftSubmit = Static<typeof draftSchema>;

/** Problems with one draft (null = usable). */
export function draftProblem(d: DraftSubmit["cards"][number], nodeIds: ReadonlySet<string>): string | null {
	if (!nodeIds.has(d.nodeId)) return `unknown nodeId "${d.nodeId}"`;
	if (!d.question.trim()) return "empty question";
	if (d.tool === "quiz") {
		try {
			const opts = normalizeOptions(d.options);
			if (opts.length < 3 || opts.length > 5) return "a quiz card needs 3-5 options";
			const r = resolveCorrect(d.correctAnswer, opts);
			if (r.error) return r.error;
		} catch (e) {
			return e instanceof Error ? e.message : String(e);
		}
	} else if (typeof d.correctAnswer !== "string" || !d.correctAnswer.trim()) return "an explain card needs a correctAnswer text";
	return null;
}

export function toDraft(d: DraftSubmit["cards"][number]): CardDraft {
	const args: Record<string, unknown> = { type: "check", nodeId: d.nodeId, question: d.question.trim(), correctAnswer: d.correctAnswer };
	if (d.tool === "quiz") {
		args.options = d.options;
		args.explanation = d.explanation?.trim() || "";
	}
	return { nodeId: d.nodeId, tool: d.tool, args };
}

/** The steps to write for: the given one, or the ones with the most misses. */
export function targetNodes(chat: ChatRecord, cards: readonly Card[], nodeId: string | "weak"): string[] {
	const ids = (chat.tree?.nodes ?? []).map((n) => n.id);
	if (nodeId !== "weak") return ids.includes(nodeId) ? [nodeId] : [];
	const misses = new Map<string, number>();
	for (const c of cards) misses.set(c.nodeId, (misses.get(c.nodeId) ?? 0) + c.lapses + (c.status === "learning" ? 1 : 0));
	const ranked = [...misses.entries()].filter(([id, n]) => n > 0 && ids.includes(id)).sort((a, b) => b[1] - a[1]);
	return (ranked.length ? ranked : [...new Set(cards.map((c) => c.nodeId))].map((id) => [id, 0] as const)).slice(0, 3).map(([id]) => id);
}

function prompt(chat: ChatRecord, nodes: string[], existing: readonly Card[], count: number): string {
	const tree = chat.tree?.nodes ?? [];
	const lines = nodes.map((id) => {
		const n = tree.find((x) => x.id === id);
		return `- ${id}: ${toSerbianLatin(n?.title ?? id)}${n?.summary ? ` — ${toSerbianLatin(n.summary)}` : ""}`;
	});
	const asked = existing
		.filter((c) => nodes.includes(c.nodeId))
		.slice(-40)
		.map((c) => `- ${toSerbianLatin(c.question).replace(/\s+/g, " ").slice(0, 200)}`);
	return [
		`Course: ${toSerbianLatin(chat.title)}`,
		`Write exactly ${count} NEW flashcards for spaced-repetition review, spread over these plan steps:`,
		...lines,
		"",
		"Questions the learner already has (do NOT repeat or rephrase them; test other facts, cases and common mistakes):",
		...(asked.length ? asked : ["- (none)"]),
		"",
		"Rules: Serbian, Latin script only. Each card tests ONE fact or skill a student must know for the exam, answerable in under a minute.",
		"Mix quiz (multiple choice with plausible distractors) and explain (short free recall). Keep code, tags and keywords verbatim in backticks or code blocks.",
		"Stay strictly within what these steps teach. Submit with submit_cards.",
	].join("\n");
}

export async function generateCardDrafts(opts: {
	chat: ChatRecord;
	nodeId: string | "weak";
	count: number;
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}): Promise<{ drafts: CardDraft[]; nodes: string[] }> {
	const { chat } = opts;
	const count = Math.min(MAX_GENERATE, Math.max(1, Math.round(opts.count)));
	const settings = cardSettings();
	const existing = buildCards({ messages: chat.messages, cards: chat.cards, tree: chat.tree, settings, now: Date.now() });
	const nodes = targetNodes(chat, existing, opts.nodeId);
	if (nodes.length === 0) throw new Error("Nema koraka za koji bi se pravila pitanja.");
	const nodeIds = new Set(nodes);
	const out = await runSubmitAgent<DraftSubmit>({
		role: "teacher",
		chatId: chat.id,
		toolName: "submit_cards",
		toolDescription: `Submit the ${count} new flashcards.`,
		parameters: draftSchema,
		fill: (input) => input as DraftSubmit,
		systemPrompt: "You write exam flashcards for a tutoring app. You receive the plan steps and the learner's existing questions, and you submit new cards through the submit tool — nothing else.",
		prompt: prompt(chat, nodes, existing, count),
		engine: opts.engine,
		signal: opts.signal,
		onStep: () => {},
		neverSubmitted: "the card writer never submitted cards",
		validate: (v) => {
			if (!v.cards.length) return "submit at least one card";
			for (const [i, d] of v.cards.entries()) {
				const p = draftProblem(d, nodeIds);
				if (p) return `card ${i + 1}: ${p}`;
			}
			return null;
		},
	});
	return { drafts: out.cards.slice(0, count).map(toDraft), nodes };
}

/** Turn kept drafts into stored generated cards. */
export function draftsToGenerated(drafts: readonly CardDraft[], now = Date.now()): GeneratedCard[] {
	return drafts.map((d) => ({ id: `g_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`, tool: d.tool, nodeId: d.nodeId, args: d.args, createdAt: new Date(now).toISOString() }));
}
