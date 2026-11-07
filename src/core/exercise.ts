/**
 * The `exercise` question tool (fork, 2026-11-07): structured, app-graded
 * teaching questions beyond multiple choice — one tool, a `format` field:
 *
 *   blanks        fill numbered gaps {{1}} {{2}} in code or text
 *   order         put shuffled steps back in order
 *   find-mistake  click the wrong line (and say why in the thinking field)
 *   match         connect each left item to its right item
 *
 * It carries the teaching-cycle pair (`type`, `nodeId`) exactly like quiz,
 * so predict/check, the reveal, plan position and progress all work
 * unchanged. Grading is pure and deterministic (this file); the model gets
 * a compact, itemized result.
 *
 * NO value imports from question-core (it imports this file's values).
 */
import { Type, type Static } from "typebox";
import type { QuestionAnswerData, QuizQuestionType } from "./question-core.ts";

export const EXERCISE_FORMATS = ["blanks", "order", "find-mistake", "match", "sql", "html", "math"] as const;
export type ExerciseFormat = (typeof EXERCISE_FORMATS)[number];

const MD = " Renders markdown and LaTeX.";

export const exerciseInputObject = Type.Object({
	type: Type.Union([Type.Literal("predict"), Type.Literal("check")], {
		description:
			"REQUIRED — the role in the teaching cycle, a bare word: predict = before you teach the step (arrives open); " +
			"check = after the step's teaching (arrives behind the Check your understanding reveal).",
	}),
	nodeId: Type.String({ description: "REQUIRED plan node id (exactly one of this session's plan_init slugs)." }),
	format: Type.Union([Type.Literal("blanks"), Type.Literal("order"), Type.Literal("find-mistake"), Type.Literal("match"), Type.Literal("sql"), Type.Literal("html"), Type.Literal("math")], {
		description:
			"REQUIRED — blanks (fill gaps in `template`), order (`steps` in the correct order; shown shuffled), " +
			"find-mistake (`lines` + the 1-based `mistakeLine`), match (`pairs`; right sides shown shuffled), " +
			"sql (he writes a query against `setupSql`; graded against `referenceSql`'s result), " +
			"html (he writes/edits HTML+CSS with a live preview; YOU grade it from his code), " +
			"math (he types a formula/number in a visual editor; checked for mathematical equality with `answerLatex`).",
	}),
	question: Type.String({ description: "The instruction/question shown above the exercise." + MD }),
	details: Type.Optional(Type.String({ description: "Optional extra context shown under the question." + MD })),
	language: Type.Optional(
		Type.String({ description: "Code language (sql, html, css, js, python, latex…) when the template/steps/lines are code; omit for prose." }),
	),
	template: Type.Optional(
		Type.String({
			description:
				"blanks only: the text or code with numbered gaps {{1}}, {{2}}, … in reading order (each number once). " +
				"Plain text, not markdown; newlines are kept.",
		}),
	),
	blanks: Type.Optional(
		Type.Array(
			Type.Object({
				accept: Type.Array(Type.String(), { minItems: 1, description: "Every accepted answer for this gap." }),
				caseSensitive: Type.Optional(Type.Boolean({ description: "Default false (SQL keywords, tags)." })),
			}),
			{ description: "blanks only: one entry per gap, in gap-number order ({{1}} first)." },
		),
	),
	steps: Type.Optional(
		Type.Array(Type.String(), { minItems: 3, maxItems: 12, description: "order only: the steps/lines in the CORRECT order (3–12; two would give the answer away)." }),
	),
	lines: Type.Optional(
		Type.Array(Type.String(), { minItems: 2, maxItems: 40, description: "find-mistake only: the numbered lines (code or derivation steps)." }),
	),
	mistakeLine: Type.Optional(Type.Integer({ minimum: 1, description: "find-mistake only: the 1-based number of the ONE wrong line." })),
	pairs: Type.Optional(
		Type.Array(
			Type.Object({ left: Type.String(), right: Type.String() }),
			{ minItems: 3, maxItems: 10, description: "match only: the correct pairs (3–10); right sides are shuffled for the learner." },
		),
	),
	setupSql: Type.Optional(
		Type.String({
			description:
				"sql only: SQLite statements that build the practice database (CREATE TABLE + INSERT rows). Small: 1–4 tables, ≤ 30 rows each. Shown to him as the schema.",
		}),
	),
	referenceSql: Type.Optional(
		Type.String({
			description:
				"sql only: YOUR correct query. His query is right when it returns the same rows and columns (column names may differ; row order matters only if yours has ORDER BY). Validated before he sees the exercise.",
		}),
	),
	answerLatex: Type.Optional(
		Type.String({
			description:
				"math only: the correct answer in LaTeX (an expression or number, e.g. 2x\\cos(x^2) or \\frac{3}{4}). Any mathematically equal form he types counts; relations/sets are left to your judgement.",
		}),
	),
	acceptLatex: Type.Optional(Type.Array(Type.String(), { description: "math only: other answers to accept (e.g. a different but valid branch)." })),
	starterCode: Type.Optional(
		Type.String({ description: "sql/html only: code pre-filled in his editor (e.g. a half-written query, or markup to fix). Omit to start empty." }),
	),
	explanation: Type.String({
		description:
			"REQUIRED. Revealed after he answers (right or wrong): why the correct answer is correct. Written before you finish the call — reason first." + MD,
	}),
});

export type ExerciseToolInput = Static<typeof exerciseInputObject>;

/** Authoring problems the model must fix (returned to it at the call boundary). */
export function exerciseInputProblems(input: ExerciseToolInput): string[] {
	const problems: string[] = [];
	if (!input.question.trim()) problems.push("question must not be empty.");
	if (!input.explanation.trim()) problems.push("explanation must not be empty.");
	switch (input.format) {
		case "blanks": {
			if (!input.template) {
				problems.push("blanks needs `template` with numbered gaps {{1}}, {{2}}, ….");
				break;
			}
			const nums = blankNumbers(input.template);
			const count = input.blanks?.length ?? 0;
			if (nums.length === 0) problems.push("template has no gaps — mark them {{1}}, {{2}}, ….");
			const expected = nums.map((_, i) => i + 1);
			if (nums.join(",") !== expected.join(",")) {
				problems.push(`gaps must be numbered {{1}}..{{${nums.length}}} in reading order, each once (found ${nums.map((n) => `{{${n}}}`).join(" ")}).`);
			}
			if (count !== nums.length) problems.push(`blanks has ${count} entr${count === 1 ? "y" : "ies"} but the template has ${nums.length} gap(s) — one entry per gap.`);
			input.blanks?.forEach((b, i) => {
				if (b.accept.every((a) => !a.trim())) problems.push(`blanks[${i}] has no non-empty accepted answer.`);
			});
			break;
		}
		case "order":
			if (!input.steps || input.steps.length < 3) problems.push("order needs `steps` (3–12) in the correct order.");
			else if (new Set(input.steps.map((s) => s.trim())).size !== input.steps.length) problems.push("order steps must be distinct (identical lines make the order ambiguous).");
			break;
		case "find-mistake":
			if (!input.lines || input.lines.length < 2) problems.push("find-mistake needs `lines` (2 or more).");
			if (input.mistakeLine === undefined) problems.push("find-mistake needs `mistakeLine` (1-based).");
			else if (input.lines && (input.mistakeLine < 1 || input.mistakeLine > input.lines.length)) {
				problems.push(`mistakeLine ${input.mistakeLine} is outside 1..${input.lines.length}.`);
			}
			break;
		case "sql":
			if (!input.setupSql?.trim()) problems.push("sql needs `setupSql` (CREATE TABLE + INSERT statements).");
			if (!input.referenceSql?.trim()) problems.push("sql needs `referenceSql` (your correct query).");
			break;
		case "html":
			break;
		case "math":
			if (!input.answerLatex?.trim()) problems.push("math needs `answerLatex` (the correct answer in LaTeX).");
			break;
		case "match":
			if (!input.pairs || input.pairs.length < 3) problems.push("match needs `pairs` (3–10).");
			else {
				if (new Set(input.pairs.map((p) => p.left.trim())).size !== input.pairs.length) problems.push("match left sides must be distinct.");
				if (new Set(input.pairs.map((p) => p.right.trim())).size !== input.pairs.length) problems.push("match right sides must be distinct.");
			}
			break;
	}
	return problems;
}

/** Gap numbers in reading order ({{1}} {{2}} …). */
export function blankNumbers(template: string): number[] {
	return [...template.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

/** The template split into text runs and gap slots, for rendering. */
export function templateSegments(template: string): Array<{ text: string } | { gap: number }> {
	const out: Array<{ text: string } | { gap: number }> = [];
	let last = 0;
	for (const m of template.matchAll(/\{\{(\d+)\}\}/g)) {
		if (m.index! > last) out.push({ text: template.slice(last, m.index) });
		out.push({ gap: Number(m[1]) - 1 });
		last = m.index! + m[0].length;
	}
	if (last < template.length) out.push({ text: template.slice(last) });
	return out;
}

// ─── deterministic shuffling (seeded by the toolCallId, hydration-safe) ─────

function seeded(seed: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A permutation of 0..n-1 that is never the identity when n >= 2 (an
 *  already-solved order or match would give the answer away). */
export function exerciseShuffle(n: number, seed: string): number[] {
	const idx = Array.from({ length: n }, (_, i) => i);
	const rand = seeded(seed);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[idx[i], idx[j]] = [idx[j]!, idx[i]!];
	}
	if (n >= 2 && idx.every((v, i) => v === i)) idx.push(idx.shift()!);
	return idx;
}

// ─── responses and grading ───────────────────────────────────────────────────

export type ExerciseResponse =
	| { format: "blanks"; values: string[] }
	/** Original step indices, in the learner's order. */
	| { format: "order"; order: number[] }
	/** 1-based line number. */
	| { format: "find-mistake"; line: number }
	/** For each left index: the pair index whose right side he chose (-1 = none). */
	| { format: "match"; picks: number[] }
	/** His query and what it returned (graded client-side by running both). */
	| { format: "sql"; query: string; matched: boolean; columns: string[]; rows: SqlCell[][]; error?: string; expectedRows?: number; orderUnverified?: boolean }
	/** His markup; the teacher grades it. */
	| { format: "html"; code: string }
	/** His formula (LaTeX) and the app's equivalence verdict. */
	| { format: "math"; latex: string; verdict: "equal" | "different" | "undecided" };

export type SqlCell = string | number | null;

/** The SQL result-set comparison (pure): same column count and the same
 *  rows; order matters only when the reference sorts. Cells compare by
 *  value — numbers numerically (1 = 1.0), text trimmed, NULL as NULL. */
export function sqlResultsMatch(
	reference: { columns: string[]; rows: SqlCell[][] },
	got: { columns: string[]; rows: SqlCell[][] },
	ordered: boolean,
): boolean {
	if (reference.columns.length !== got.columns.length) return false;
	if (reference.rows.length !== got.rows.length) return false;
	const cell = (v: SqlCell): string => (v === null ? "\u0000NULL" : typeof v === "number" ? `n:${Number(v.toPrecision(12))}` : `s:${String(v).trim()}`);
	const key = (row: SqlCell[]) => JSON.stringify(row.map(cell));
	const a = reference.rows.map(key);
	const b = got.rows.map(key);
	if (!ordered) {
		a.sort();
		b.sort();
	}
	return a.every((k, i) => k === b[i]);
}

/** Does the reference query impose an order? (top-level ORDER BY) */
export function sqlIsOrdered(referenceSql: string): boolean {
	// Only a TOP-LEVEL ORDER BY orders the result: strip strings, comments,
	// then every parenthesized group (subqueries, OVER (...), group_concat).
	let s = referenceSql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
	for (let prev = ""; prev !== s; ) {
		prev = s;
		s = s.replace(/\([^()]*\)/g, " ");
	}
	return /\border\s+by\b/i.test(s);
}

// ─── exact tie handling for sorted references (fork) ─────────────────────────

/** Top-level structure of one SELECT: keyword positions outside strings,
 *  comments and parentheses. Null for shapes we don't rewrite. */
function topLevelScan(sql: string): { masked: string } {
	// Same length as sql: strings/comments/parenthesized text become spaces,
	// so indices found in `masked` are valid in `sql`.
	const out = sql.split("");
	let depth = 0;
	for (let i = 0; i < sql.length; i++) {
		const c = sql[i]!;
		if (c === "'" || c === '"' || c === "`") {
			const q = c;
			let j = i + 1;
			while (j < sql.length && !(sql[j] === q && sql[j + 1] !== q)) j += sql[j] === q ? 2 : 1;
			for (let k = i; k <= Math.min(j, sql.length - 1); k++) out[k] = " ";
			i = j;
			continue;
		}
		if (c === "-" && sql[i + 1] === "-") {
			let j = i;
			while (j < sql.length && sql[j] !== "\n") out[j++] = " ";
			i = j;
			continue;
		}
		if (c === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			const j = end < 0 ? sql.length : end + 2;
			for (let k = i; k < j; k++) out[k] = " ";
			i = j - 1;
			continue;
		}
		if (c === "(") {
			depth++;
			out[i] = " ";
			continue;
		}
		if (c === ")") {
			depth = Math.max(0, depth - 1);
			out[i] = " ";
			continue;
		}
		if (depth > 0) out[i] = " ";
	}
	return { masked: out.join("") };
}

/** Split a top-level comma list (commas inside parentheses/strings kept). */
function splitTopLevel(text: string): string[] {
	const { masked } = topLevelScan(text);
	const parts: string[] = [];
	let last = 0;
	for (let i = 0; i < masked.length; i++) {
		if (masked[i] === ",") {
			parts.push(text.slice(last, i));
			last = i + 1;
		}
	}
	parts.push(text.slice(last));
	return parts.map((p) => p.trim()).filter(Boolean);
}

export interface SqlKeyedQuery {
	/** The reference with its ORDER BY keys appended to the select list. */
	sql: string;
	/** Per sort key: an appended column (index after the original columns) or
	 *  a 1-based output position (ORDER BY 2). */
	keys: Array<{ appended: number } | { position: number }>;
}

/**
 * Rewrite a sorted reference so it ALSO returns its sort keys:
 *   SELECT name FROM e ORDER BY dept, age DESC
 *   → SELECT name, (dept) AS __lh_k0, (age) AS __lh_k1 FROM e ORDER BY dept, age DESC
 * Rows with equal keys are ties — any order among them is correct. Returns
 * null for shapes this can't rewrite safely (DISTINCT, compound queries, no
 * top-level ORDER BY); the caller falls back.
 */
export function sqlWithOrderKeys(referenceSql: string): SqlKeyedQuery | null {
	const sql = referenceSql.trim().replace(/;\s*$/, "");
	const { masked } = topLevelScan(sql);
	const lower = masked.toLowerCase();
	if (/\b(union|intersect|except)\b/.test(lower)) return null;
	const select = lower.search(/\bselect\b/);
	if (select < 0) return null;
	if (/^\s*distinct\b/.test(lower.slice(select + 6))) return null;
	const orderMatch = /\border\s+by\b/.exec(lower);
	if (!orderMatch) return null;
	const orderStart = orderMatch.index;
	const keysStart = orderStart + orderMatch[0].length;
	const limit = /\blimit\b/.exec(lower.slice(keysStart));
	const keysEnd = limit ? keysStart + limit.index : sql.length;
	const keyExprs = splitTopLevel(sql.slice(keysStart, keysEnd)).map((k) =>
		k.replace(/\s+collate\s+\w+/i, "").replace(/\s+nulls\s+(first|last)\s*$/i, "").replace(/\s+(asc|desc)\s*$/i, "").trim(),
	);
	if (keyExprs.length === 0) return null;
	const fromMatch = /\bfrom\b/.exec(lower.slice(select));
	const insertAt = fromMatch ? select + fromMatch.index : orderStart;
	const keys: SqlKeyedQuery["keys"] = [];
	const added: string[] = [];
	for (const expr of keyExprs) {
		if (/^\d+$/.test(expr)) keys.push({ position: Number(expr) });
		else {
			keys.push({ appended: added.length });
			added.push(`(${expr}) AS __lh_k${added.length}`);
		}
	}
	if (added.length === 0) return { sql, keys };
	const before = sql.slice(0, insertAt).replace(/\s+$/, "");
	return { sql: `${before}, ${added.join(", ")} ${sql.slice(insertAt)}`, keys };
}

/**
 * Tie-aware ordered comparison: walk the keyed reference in order, group
 * consecutive rows with equal keys (ties), and require the learner's rows to
 * match each group as a multiset, group by group. Exact — no flag needed.
 */
export function sqlMatchesWithTies(
	keyed: { columns: string[]; rows: SqlCell[][] },
	keys: SqlKeyedQuery["keys"],
	visibleColumns: number,
	got: { columns: string[]; rows: SqlCell[][] },
): boolean {
	if (got.columns.length !== visibleColumns || got.rows.length !== keyed.rows.length) return false;
	const keyOf = (row: SqlCell[]) =>
		JSON.stringify(keys.map((k) => ("appended" in k ? row[visibleColumns + k.appended] : row[k.position - 1]) ?? null));
	const cell = (v: SqlCell): string => (v === null ? "\u0000NULL" : typeof v === "number" ? `n:${Number(v.toPrecision(12))}` : `s:${String(v).trim()}`);
	const rowKey = (row: SqlCell[]) => JSON.stringify(row.slice(0, visibleColumns).map(cell));
	let i = 0;
	while (i < keyed.rows.length) {
		const k = keyOf(keyed.rows[i]!);
		let j = i;
		while (j < keyed.rows.length && keyOf(keyed.rows[j]!) === k) j++;
		const want = keyed.rows.slice(i, j).map(rowKey).sort();
		const have = got.rows.slice(i, j).map(rowKey).sort();
		if (want.some((w, n) => w !== have[n])) return false;
		i = j;
	}
	return true;
}

/** SQL grading verdict: exact match, or (when the reference sorts) the same
 *  rows in a different order from a query that ALSO sorts — ties may
 *  legitimately order differently, so that counts, flagged for the teacher. */
export function sqlVerdict(
	reference: { columns: string[]; rows: SqlCell[][] },
	got: { columns: string[]; rows: SqlCell[][] },
	referenceSql: string,
	query: string,
): { matched: boolean; orderUnverified?: boolean } {
	const ordered = sqlIsOrdered(referenceSql);
	if (sqlResultsMatch(reference, got, ordered)) return { matched: true };
	if (ordered && sqlIsOrdered(query) && sqlResultsMatch(reference, got, false)) return { matched: true, orderUnverified: true };
	return { matched: false };
}

export interface ExerciseResult {
	/** Fork: false for formats the TEACHER grades (html) — no verdict chip. */
	graded?: boolean;
	correct: boolean;
	/** 0..1 — the share of items right. */
	score: number;
	/** Per item: gaps, positions, the one line, or pairs. */
	items: boolean[];
}

function normalizeAnswer(s: string, caseSensitive: boolean): string {
	const t = s.trim().replace(/\s+/g, " ");
	return caseSensitive ? t : t.toLowerCase();
}

export function gradeExercise(input: ExerciseToolInput, response: ExerciseResponse): ExerciseResult {
	let items: boolean[] = [];
	switch (input.format) {
		case "blanks": {
			const values = response.format === "blanks" ? response.values : [];
			items = (input.blanks ?? []).map((b, i) => {
				const given = normalizeAnswer(values[i] ?? "", b.caseSensitive === true);
				return given.length > 0 && b.accept.some((a) => normalizeAnswer(a, b.caseSensitive === true) === given);
			});
			break;
		}
		case "order": {
			const order = response.format === "order" ? response.order : [];
			items = (input.steps ?? []).map((_, pos) => order[pos] === pos);
			break;
		}
		case "find-mistake":
			items = [response.format === "find-mistake" && response.line === input.mistakeLine];
			break;
		case "match": {
			const picks = response.format === "match" ? response.picks : [];
			items = (input.pairs ?? []).map((_, i) => picks[i] === i);
			break;
		}
		case "sql":
			items = [response.format === "sql" && response.matched && !response.error];
			break;
		case "html":
			return { graded: false, correct: false, score: 0, items: [] };
		case "math":
			if (response.format === "math" && response.verdict === "undecided") return { graded: false, correct: false, score: 0, items: [] };
			items = [response.format === "math" && response.verdict === "equal"];
			break;
	}
	const right = items.filter(Boolean).length;
	return { correct: items.length > 0 && right === items.length, score: items.length ? right / items.length : 0, items };
}

/** The itemized result the TEACHER reads (compact, no rendering data). */
export function exerciseResultForModel(input: ExerciseToolInput | undefined, response: ExerciseResponse | undefined, result: ExerciseResult | undefined): Record<string, unknown> {
	if (!input || !response || !result) return {};
	const out: Record<string, unknown> = { format: input.format, correct: result.correct, score: Math.round(result.score * 100) / 100 };
	switch (input.format) {
		case "blanks":
			if (response.format === "blanks") {
				out.gaps = (input.blanks ?? []).map((b, i) => ({
					given: response.values[i] ?? "",
					ok: result.items[i] === true,
					...(result.items[i] ? {} : { expected: b.accept[0] }),
				}));
			}
			break;
		case "order":
			if (response.format === "order") {
				out.givenOrder = response.order.map((i) => input.steps?.[i] ?? "");
				out.positionsRight = result.items.filter(Boolean).length;
			}
			break;
		case "find-mistake":
			if (response.format === "find-mistake") {
				out.chosenLine = response.line;
				out.chosenText = input.lines?.[response.line - 1] ?? "";
				if (!result.correct) out.mistakeLine = input.mistakeLine;
			}
			break;
		case "sql":
			if (response.format === "sql") {
				out.query = response.query;
				if (response.error) out.error = response.error;
				else {
					out.rowCount = response.rows.length;
					out.columns = response.columns;
					out.rowsPreview = response.rows.slice(0, 8);
				}
				if (response.expectedRows !== undefined) out.expectedRowCount = response.expectedRows;
				if (response.orderUnverified) out.note = "Same rows as the reference but in a different order; his query sorts too — check that he sorts by the right key (ties may differ legitimately).";
			}
			break;
		case "html":
			if (response.format === "html") {
				delete out.correct;
				delete out.score;
				out.graded = false;
				out.code = response.code.length > 12000 ? `${response.code.slice(0, 12000)}\n…(truncated)` : response.code;
				out.note = "Grade this markup yourself against what you asked for; he has seen its live preview.";
			}
			break;
		case "math":
			if (response.format === "math") {
				out.latex = response.latex;
				out.check = response.verdict;
				if (response.verdict === "undecided") {
					delete out.correct;
					delete out.score;
					out.graded = false;
					out.note = "The app could not decide equality (relation, set, or unusual notation) — judge his answer yourself.";
				}
			}
			break;
		case "match":
			if (response.format === "match") {
				out.pairs = (input.pairs ?? []).map((p, i) => ({
					left: p.left,
					chose: response.picks[i] !== undefined && response.picks[i]! >= 0 ? input.pairs?.[response.picks[i]!]?.right ?? "" : "",
					ok: result.items[i] === true,
				}));
			}
			break;
	}
	return out;
}

/** Is the response complete enough to submit? */
export function exerciseResponseComplete(input: ExerciseToolInput, response: ExerciseResponse | null): boolean {
	if (!response) return false;
	switch (response.format) {
		case "blanks":
			return (input.blanks ?? []).every((_, i) => (response.values[i] ?? "").trim().length > 0);
		case "order":
			return response.order.length === (input.steps?.length ?? 0);
		case "find-mistake":
			return response.line >= 1;
		case "match":
			return (input.pairs ?? []).every((_, i) => (response.picks[i] ?? -1) >= 0);
		case "sql":
			return response.query.trim().length > 0;
		case "html":
			return response.code.trim().length > 0;
		case "math":
			return response.latex.trim().length > 0;
	}
}

// ─── the answer record ───────────────────────────────────────────────────────


/** The exercise slice of QuestionAnswerData (render + model summary). */
export interface ExerciseAnswer {
	format: ExerciseFormat;
	response: ExerciseResponse;
	result: ExerciseResult;
	/** The compact itemized result the model reads (precomputed with the input). */
	summary: Record<string, unknown>;
}

export function buildExerciseAnswer(
	input: ExerciseToolInput,
	req: { response: ExerciseResponse | null; dontKnow?: boolean; thinking?: string; readingThinking?: string; confidence?: number },
	tool = "exercise",
): QuestionAnswerData {
	const dontKnow = req.dontKnow === true || !req.response;
	const base: QuestionAnswerData = {
		kind: "exercise",
		tool,
		questionType: input.type as QuizQuestionType,
		questionText: input.question,
		dontKnow,
		answers: [],
		thinking: req.thinking?.trim() || undefined,
		readingThinking: req.readingThinking?.trim() || undefined,
		explanation: input.explanation,
		answeredAt: new Date().toISOString(),
	};
	if (dontKnow) {
		base.correct = false;
		return base;
	}
	const response = req.response!;
	const result = gradeExercise(input, response);
	// Teacher-graded formats carry no app verdict.
	base.correct = result.graded === false ? undefined : result.correct;
	base.exercise = { format: input.format, response, result, summary: exerciseResultForModel(input, response, result) };
	if (req.confidence !== undefined) base.confidence = Math.max(0, Math.min(100, Math.round(req.confidence)));
	return base;
}
