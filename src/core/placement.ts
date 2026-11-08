/**
 * Placement (fork, 2026-11-08): three ways to start a course — the adaptive
 * probe ("brza"), a full written test over the whole syllabus ("test"), or
 * no testing ("nula"). The test is two question tools: `placement_test`
 * (every topic, 1-4 questions each, one page the learner works through) and
 * `placement_result` (per-topic scores + a proposal the learner confirms or
 * changes). Both answer as kind "ask" with a JSON text, so the answer path,
 * dismissals and replays need nothing new.
 *
 * Pure: no runtime deps besides typebox.
 */
import { Type, type Static } from "typebox";

export type StartMode = "brza" | "test" | "nula";
export const START_MODES: readonly StartMode[] = ["brza", "test", "nula"];
export const START_MODE_LABELS: Record<StartMode, string> = {
	brza: "Brza provera",
	test: "Test znanja",
	nula: "Od nule",
};

/** The prober's instruction for the chosen start (model-facing, hidden). */
export function startModeText(mode: StartMode): string {
	if (mode === "test")
		return "[Session context] The learner chose to start with a FULL PLACEMENT TEST (Test znanja). After making the goal concrete (one or two ask_user_question at most), build the test with placement_test covering EVERY topic of the syllabus/material — do not run the adaptive probe. Then grade it and call placement_result; after the learner confirms, conclude with probe_done from the confirmed decisions.";
	if (mode === "nula")
		return "[Session context] The learner chose to start FROM ZERO (Od nule): no testing. Ask only what you need to make the goal concrete, then conclude with probe_done immediately — every strand at floor zero (nothing assumed known), so the plan starts from the very beginning.";
	return "[Session context] The learner chose the quick adaptive check (Brza provera): probe as usual.";
}

// ─── placement_test ────────────────────────────────────────────────────────

export const PLACEMENT_QUESTION_KINDS = ["quiz", "short", "math"] as const;

export const placementQuestionSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 40, description: "Unique within the test, e.g. 'html-2'." }),
	kind: Type.Union([Type.Literal("quiz"), Type.Literal("short"), Type.Literal("math")], {
		description: "quiz = multiple choice (app-graded); short = free short answer (YOU grade it from correctAnswer); math = a formula answer (app-graded, Wolfram when unsure).",
	}),
	question: Type.String({ minLength: 1, description: "Markdown; code in fenced blocks; math in $…$." }),
	options: Type.Optional(Type.Array(Type.Object({ label: Type.String(), value: Type.String() }), { description: "quiz: 3-5 options." })),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description: "quiz: the correct option value(s). short: the model answer you will grade against. math: the expected answer in LaTeX.",
	}),
});
export type PlacementQuestion = Static<typeof placementQuestionSchema>;

export const placementTestSchema = Type.Object({
	title: Type.String({ minLength: 1, maxLength: 120 }),
	intro: Type.Optional(Type.String({ maxLength: 1_000, description: "One or two sentences for the learner (no answers!)." })),
	topics: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, maxLength: 60, description: "A short slug for the topic (becomes the plan strand)." }),
			title: Type.String({ minLength: 1, maxLength: 120 }),
			questions: Type.Array(placementQuestionSchema, { minItems: 1, maxItems: 4 }),
		}),
		{ minItems: 2, maxItems: 25 },
	),
});
export type PlacementTestInput = Static<typeof placementTestSchema>;

export const MAX_PLACEMENT_QUESTIONS = 60;

/** Authoring problems the model must fix. */
export function placementTestProblems(input: PlacementTestInput): string[] {
	const problems: string[] = [];
	const total = input.topics.reduce((n, t) => n + t.questions.length, 0);
	if (total > MAX_PLACEMENT_QUESTIONS) problems.push(`at most ${MAX_PLACEMENT_QUESTIONS} questions in total (you have ${total}).`);
	const ids = new Set<string>();
	const topicIds = new Set<string>();
	for (const t of input.topics) {
		if (topicIds.has(t.id)) problems.push(`duplicate topic id "${t.id}".`);
		topicIds.add(t.id);
		for (const q of t.questions) {
			if (ids.has(q.id)) problems.push(`duplicate question id "${q.id}".`);
			ids.add(q.id);
			if (q.kind === "quiz") {
				const opts = q.options ?? [];
				if (opts.length < 3 || opts.length > 5) problems.push(`question "${q.id}": a quiz needs 3-5 options.`);
				const values = new Set(opts.map((o) => o.value));
				const keys = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
				if (!keys.length || keys.some((k) => !values.has(k))) problems.push(`question "${q.id}": correctAnswer must be option value(s).`);
			} else if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) problems.push(`question "${q.id}": needs a correctAnswer.`);
		}
	}
	return problems;
}

/** What the learner submits for one question. */
export interface PlacementAnswer {
	qid: string;
	/** quiz: the chosen option values; short/math: the text / LaTeX. */
	value: string | string[];
	dontKnow?: boolean;
	/** The app's verdict where it can grade (quiz, math). */
	correct?: boolean;
	/** math: decided by Wolfram|Alpha. */
	checkedBy?: "wolfram";
}

export function quizCorrect(q: PlacementQuestion, chosen: readonly string[]): boolean {
	const keys = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
	return chosen.length === keys.length && keys.every((k) => chosen.includes(k));
}

/** The test result the prober reads (the answer's text), per topic. */
export function placementAnswerText(test: PlacementTestInput, answers: readonly PlacementAnswer[]): string {
	const by = new Map(answers.map((a) => [a.qid, a]));
	return JSON.stringify({
		placementTest: test.title,
		note: "short answers are ungraded: grade them yourself against correctAnswer from your placement_test call; then call placement_result.",
		topics: test.topics.map((t) => {
			const qs = t.questions.map((q) => {
				const a = by.get(q.id);
				return {
					qid: q.id,
					kind: q.kind,
					answer: a?.dontKnow ? "(ne znam)" : (a?.value ?? "(bez odgovora)"),
					...(a?.correct !== undefined ? { correct: a.correct } : {}),
					...(a?.checkedBy ? { checkedBy: "Wolfram|Alpha" } : {}),
				};
			});
			const graded = qs.filter((q) => "correct" in q);
			return { topic: t.id, title: t.title, autoGraded: `${graded.filter((q) => q.correct).length}/${graded.length}`, questions: qs };
		}),
	});
}

// ─── placement_result ──────────────────────────────────────────────────────

export const PLACEMENT_DECISIONS = ["znam", "ponoviti", "ucim"] as const;
export type PlacementDecision = (typeof PLACEMENT_DECISIONS)[number];
export const PLACEMENT_DECISION_LABELS: Record<PlacementDecision, string> = { znam: "Znam", ponoviti: "Ponoviti", ucim: "Učim od početka" };

export const placementResultSchema = Type.Object({
	summary: Type.Optional(Type.String({ maxLength: 1_500, description: "2-3 sentences for the learner about the overall result." })),
	topics: Type.Array(
		Type.Object({
			id: Type.String({ description: "The topic id from placement_test." }),
			title: Type.String(),
			score: Type.Number({ minimum: 0, maximum: 100, description: "Percent right in this topic (your grading of short answers included)." }),
			proposal: Type.Union([Type.Literal("znam"), Type.Literal("ponoviti"), Type.Literal("ucim")], { description: "znam = already known (skip); ponoviti = known but shaky (quick review); ucim = learn from the start." }),
			note: Type.Optional(Type.String({ maxLength: 300, description: "One short line: what showed this." })),
		}),
		{ minItems: 1, maxItems: 25 },
	),
});
export type PlacementResultInput = Static<typeof placementResultSchema>;

/** The learner's confirmed decisions (the answer's text). */
export function placementDecisionText(result: PlacementResultInput, decisions: Record<string, PlacementDecision>): string {
	const rows = result.topics.map((t) => {
		const d = decisions[t.id] ?? t.proposal;
		return { topic: t.id, title: t.title, score: t.score, decision: d, ...(d !== t.proposal ? { changedByLearner: `from ${t.proposal}` } : {}) };
	});
	return JSON.stringify({
		placementDecisions: rows,
		note: "Confirmed by the learner. Build the plan from these: 'znam' topics are skipped (mark them done after planning), 'ponoviti' get a short review step, 'ucim' are taught fully.",
	});
}
