/**
 * Topic notes (fork, 2026-11-08): one notes document per course, one section
 * per plan step, written in the background from what was actually taught.
 * See docs/fork-plans/notes-stats-sidechat-plan.md.
 *
 * Which part of the lesson belongs to which step: position moves at the
 * teacher's tagged question calls (contracts/plan.ts derivePlanStatusesLh),
 * and a step's explanations come right BEFORE its questions. So a step's
 * window is the stretch from the end of the previous step's last question
 * up to its own last question, plus the answers and the teacher's next
 * message (the feedback). Windows of neighbouring steps overlap by that
 * feedback message; the writer is told to keep only what belongs to its step.
 *
 * Pure: no runtime deps.
 */
import type { PlanTree } from "./contracts/plan.ts";
import type { LhMessage } from "./native-messages.ts";
import { toSerbianLatin } from "./serbian-latin.ts";

export interface NoteSection {
	/** The section body (Markdown, no step heading). */
	markdown: string;
	/** Id of the last transcript message the section covers. */
	coveredTo: string;
	updatedAt: string;
}

/** Something the learner saved into the notes by hand (e.g. a side answer). */
export interface NoteExtra {
	id: string;
	title: string;
	markdown: string;
	at: string;
	source: "side";
}

/** ChatRecord.notes */
export interface CourseNotes {
	/** Short course name for the file ("Veb dizajn"), written once. */
	courseTitle?: string;
	/** The notes file's name in the notes folder, fixed at the first write. */
	fileName?: string;
	sections?: Record<string, NoteSection>;
	extras?: Record<string, NoteExtra[]>;
}

const QUESTION_TOOLS = new Set(["quiz", "explain", "exercise"]);

interface Block {
	type?: string;
	name?: string;
	arguments?: unknown;
}

/** Message index of each tagged question call, in order. */
function taggedCalls(tree: PlanTree, messages: readonly LhMessage[]): Array<{ index: number; nodeId: string }> {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const out: Array<{ index: number; nodeId: string }> = [];
	messages.forEach((m, index) => {
		if ((m as { role?: string }).role !== "assistant") return;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) return;
		for (const b of content as Block[]) {
			if (b.type !== "toolCall" || !QUESTION_TOOLS.has(b.name ?? "")) continue;
			const nodeId = (b.arguments as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId === "string" && ids.has(nodeId)) out.push({ index, nodeId });
		}
	});
	return out;
}

/** The first message after the plan was made (teaching starts there). */
function teachingStart(messages: readonly LhMessage[]): number {
	for (let i = 0; i < messages.length; i++) {
		const content = (messages[i] as { content?: unknown }).content;
		if (Array.isArray(content) && (content as Block[]).some((b) => b.type === "toolCall" && b.name === "plan_init")) return i + 1;
	}
	return 0;
}

/** For each taught step: its windows as [from, to] message indexes (inclusive). */
export function nodeWindows(tree: PlanTree, messages: readonly LhMessage[]): Map<string, Array<[number, number]>> {
	const calls = taggedCalls(tree, messages);
	const out = new Map<string, Array<[number, number]>>();
	if (calls.length === 0) return out;
	// Collapse consecutive calls on one step into runs.
	const runs: Array<{ nodeId: string; first: number; last: number }> = [];
	for (const c of calls) {
		const prev = runs.at(-1);
		if (prev && prev.nodeId === c.nodeId) prev.last = c.index;
		else runs.push({ nodeId: c.nodeId, first: c.index, last: c.index });
	}
	let from = teachingStart(messages);
	for (const run of runs) {
		// Through the answers and the teacher's next message (the feedback).
		let to = run.last;
		while (to + 1 < messages.length && (messages[to + 1] as { role?: string }).role !== "assistant") to++;
		if (to + 1 < messages.length) to++;
		const list = out.get(run.nodeId) ?? [];
		list.push([Math.min(from, run.first), to]);
		out.set(run.nodeId, list);
		from = run.last + 1;
	}
	return out;
}

/** The transcript slice a step's notes are written from. */
export function nodeMessages(windows: ReadonlyArray<[number, number]>, messages: readonly LhMessage[]): LhMessage[] {
	const picked = new Set<number>();
	for (const [a, b] of windows) for (let i = a; i <= b; i++) picked.add(i);
	return [...picked].sort((x, y) => x - y).map((i) => messages[i]!);
}

/** Keep sections under the file's "## N. step" headings: # / ## become ###. */
export function demoteHeadings(md: string): string {
	let fence = false;
	return md
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) fence = !fence;
			return !fence && /^#{1,2}\s/.test(line) ? line.replace(/^#{1,2}\s/, "### ") : line;
		})
		.join("\n");
}

export type NoteStatus = "written" | "stale" | "pending" | "untaught";

export interface NoteStepView {
	id: string;
	/** "1. Šira slika…" numbering follows the plan's node order. */
	number: number;
	title: string;
	status: NoteStatus;
	markdown: string | null;
	updatedAt: string | null;
	extras: NoteExtra[];
	/** The teacher marked the step done (plan_progress). */
	done: boolean;
}

/** The state of every step's section. `current` is the step being taught now
 *  (its section is written once the lesson moves on, or on request). */
export function noteSteps(
	tree: PlanTree,
	messages: readonly LhMessage[],
	notes: CourseNotes | undefined,
	current: string | null,
	done: ReadonlySet<string> = new Set(),
): NoteStepView[] {
	const windows = nodeWindows(tree, messages);
	return tree.nodes.map((n, i) => {
		const w = windows.get(n.id);
		const section = notes?.sections && Object.prototype.hasOwnProperty.call(notes.sections, n.id) ? notes.sections[n.id] : undefined;
		const lastId = w ? (messages[w.at(-1)![1]] as { id?: string } | undefined)?.id : undefined;
		let status: NoteStatus = "untaught";
		if (w) status = section ? (section.coveredTo === lastId ? "written" : "stale") : n.id === current ? "pending" : "stale";
		if (w && section && section.coveredTo !== lastId && n.id === current) status = "pending";
		return {
			id: n.id,
			number: i + 1,
			title: toSerbianLatin(n.title),
			status,
			markdown: section ? demoteHeadings(section.markdown) : null,
			updatedAt: section?.updatedAt ?? null,
			extras: notes?.extras && Object.prototype.hasOwnProperty.call(notes.extras, n.id) ? notes.extras[n.id]! : [],
			done: done.has(n.id),
		};
	});
}

/** The line that marks a notes file as this course's (so two courses with
 *  the same name never overwrite each other's file). */
export const notesMarker = (chatId: string) => `<!-- learnharness:${chatId} -->`;

/** The whole notes file. */
export function notesDocument(courseTitle: string, steps: readonly NoteStepView[], chatId?: string): string {
	const parts = [...(chatId ? [notesMarker(chatId)] : []), `# ${courseTitle}`, ""];
	for (const s of steps) {
		parts.push(`## ${s.number}. ${s.title}`, "");
		if (s.markdown) parts.push(s.markdown.trim(), "");
		else parts.push("_Još nije obrađeno._", "");
		for (const e of s.extras) parts.push(`### Dodatno: ${e.title}`, "", e.markdown.trim(), "");
	}
	return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const clip = (v: unknown, n = 600) => {
	const t = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
	return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** The answer keys of the questions in a transcript slice — the lesson
 *  markdown shows only the question text and right/wrong, so the notes
 *  writer gets the real answers from the calls themselves. */
export function questionKeys(slice: readonly LhMessage[]): string {
	const out: string[] = [];
	for (const m of slice) {
		const content = (m as { role?: string; content?: unknown }).content;
		if ((m as { role?: string }).role !== "assistant" || !Array.isArray(content)) continue;
		for (const b of content as Block[]) {
			if (b.type !== "toolCall" || !QUESTION_TOOLS.has(b.name ?? "")) continue;
			const a = (b.arguments ?? {}) as Record<string, unknown>;
			const lines = [`- **${clip(a.question, 400)}**`];
			if (b.name === "quiz" && Array.isArray(a.options)) {
				const opts = (a.options as Array<{ label?: unknown; value?: unknown }>).filter((o) => o && typeof o.label === "string");
				lines.push(`  - Opcije: ${opts.map((o) => String(o.label)).join(" | ")}`);
				const keys = Array.isArray(a.correctAnswer) ? a.correctAnswer : [a.correctAnswer];
				const right = opts.filter((o) => keys.includes(o.value ?? o.label)).map((o) => String(o.label));
				lines.push(`  - Tačno: ${right.length ? right.join(" | ") : clip(a.correctAnswer)}`);
			} else if (b.name === "explain") {
				lines.push(`  - Tačan odgovor: ${clip(a.correctAnswer)}`);
			} else {
				const key = Object.fromEntries(
					Object.entries(a).filter(([k]) => ["blanks", "steps", "lines", "mistakeLine", "pairs", "referenceSql", "answerLatex", "acceptLatex", "template"].includes(k)),
				);
				lines.push(`  - Ključ (${clip(a.format, 20)}): ${clip(key, 900)}`);
			}
			if (typeof a.explanation === "string" && a.explanation.trim()) lines.push(`  - Zašto: ${clip(a.explanation, 600)}`);
			out.push(lines.join("\n"));
		}
	}
	return out.join("\n");
}

/** A file-name-safe course name. */
export function notesFileName(courseTitle: string): string {
	const clean = toSerbianLatin(courseTitle)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/, "")
		.slice(0, 80);
	return `${clean || "Beleske"}.md`;
}

/** Steps whose section should be (re)written now: taught, out of date, not
 *  the step being taught right now (unless `includeCurrent`). */
export function staleSteps(steps: readonly NoteStepView[], includeCurrent = false): string[] {
	return steps.filter((s) => s.status === "stale" || (includeCurrent && s.status === "pending")).map((s) => s.id);
}
