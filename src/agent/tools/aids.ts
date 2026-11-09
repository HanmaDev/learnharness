import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { serverExecute } from "../tool-execute.ts";
import { createWolframTool, type WolframQuery } from "./wolfram.ts";
import { createYoutubeTool, type YoutubeFetch } from "./youtube.ts";

/** Fork (2026-11-08): optional helpers every conversation agent can carry —
 *  Wolfram (only when the learner set an App ID) and YouTube transcripts. */
export interface AgentAids {
	wolfram?: WolframQuery;
	youtube?: YoutubeFetch;
	/** The course's open mistakes as a short list (teacher only). */
	openMistakes?: () => string;
	/** Fork: the problem log — record an attempt; returns a one-line confirmation. */
	logProblem?: (input: LogProblemInput) => string;
	/** The current category ids/labels, for the tool description. */
	problemCategories?: string;
	/** Fork: look a problem up in the Matematika Tracker archive (statement image). */
	trackerLookup?: (query: string) => { text: string; images?: Array<{ data: string; mimeType: string }> };
	/** Fork (2026-11-09): read the learner's Zadaci entries (ids for edits). */
	problemList?: (filter: ProblemListInput) => string;
	/** Fork (2026-11-09): change Zadaci on the learner's instruction. */
	problemEdit?: (input: ProblemEditInput) => string;
	/** Fork (2026-11-09): add cards to this course's Kartice deck. */
	makeCards?: (cards: MakeCardInput[]) => string;
	/** This course's plan steps ("id: title" lines), for make_cards. */
	planSteps?: string;
}

export interface ProblemListInput {
	scope?: "course" | "all";
	category?: string;
	scheduledOnly?: boolean;
	query?: string;
}

export interface ProblemEditInput {
	action: "schedule" | "unschedule" | "auto" | "delete" | "plan";
	id?: string;
	date?: string;
	source?: string;
	reference?: string;
	category?: string;
	branch?: string;
	trackerId?: string;
	note?: string;
}

export interface MakeCardInput {
	nodeId: string;
	front: string;
	back: string;
}

export interface LogProblemInput {
	source: string;
	reference: string;
	outcome: "clean" | "slow" | "hint" | "read" | "unsolved";
	minutes?: number;
	branch?: string;
	category?: string;
	note?: string;
	trackerId?: string;
}

export function aidTools(aids: AgentAids | undefined): Record<string, AgentTool<any>> {
	return {
		...(aids?.wolfram ? { wolfram: createWolframTool(aids.wolfram) } : {}),
		...(aids?.youtube ? { youtube: createYoutubeTool(aids.youtube) } : {}),
		...(aids?.openMistakes ? { open_mistakes: createOpenMistakesTool(aids.openMistakes) } : {}),
		...(aids?.logProblem ? { log_problem: createLogProblemTool(aids.logProblem, aids.problemCategories ?? "") } : {}),
		...(aids?.trackerLookup ? { tracker_problem: createTrackerTool(aids.trackerLookup) } : {}),
		...(aids?.problemList ? { problem_log_list: createProblemListTool(aids.problemList) } : {}),
		...(aids?.problemEdit ? { problem_log_edit: createProblemEditTool(aids.problemEdit, aids.problemCategories ?? "") } : {}),
		...(aids?.makeCards ? { make_cards: createMakeCardsTool(aids.makeCards, aids.planSteps ?? "") } : {}),
	};
}

const logProblemInput = Type.Object({
	source: Type.String({ minLength: 1, maxLength: 120, description: 'The book or archive: "Thomas\' Calculus", "Zbirka 4. razred", "EGMO", "MONT", "Schaum\'s College Physics", "URS Predić", "DMS arhiva".' }),
	reference: Type.String({ minLength: 1, maxLength: 200, description: 'Where exactly: "3.4 / 17", "EGMO 4.12", "Okružno 2019/2020 · 4. razred · kategorija A · zadatak 3". Keep the same form for re-attempts.' }),
	outcome: Type.Union([Type.Literal("clean"), Type.Literal("slow"), Type.Literal("hint"), Type.Literal("read"), Type.Literal("unsolved")], {
		description: "clean = solved alone, cleanly; slow = alone but slow/shaky; hint = needed a hint; read = read the solution; unsolved = gave up.",
	}),
	minutes: Type.Optional(Type.Number({ minimum: 0, maximum: 1440, description: "Time spent, if the learner said." })),
	branch: Type.Optional(Type.String({ description: "Algebra, Analiza, Geometrija, Kombinatorika, Teorija brojeva, Verovatnoća, Fizika, Ostalo." })),
	category: Type.Optional(Type.String({ description: "A category id (see the description); omit to use the course's default." })),
	note: Type.Optional(Type.String({ maxLength: 500, description: "One line: the key idea or what went wrong." })),
	trackerId: Type.Optional(Type.String({ description: "The Matematika Tracker problem id, for archive problems (from tracker_problem)." })),
});

function createLogProblemTool(log: (i: LogProblemInput) => string, categories: string): AgentTool<typeof logProblemInput> {
	return {
		name: "log_problem",
		label: "log_problem",
		description:
			"Record one attempt at a problem in the learner's problem log (Zadaci): whenever the learner reports a problem they worked " +
			"(\"rešio sam 3.4/17 sam za 25 min\", \"pročitao sam rešenje za EGMO 4.12\") or after you graded their written solution. " +
			"Be honest about the outcome — it decides when the problem comes back for re-solving. " +
			(categories ? `Categories: ${categories}.` : ""),
		parameters: logProblemInput,
		execute: serverExecute("log_problem", logProblemInput, async (input) => log(input)),
	};
}

const trackerInput = Type.Object({
	query: Type.String({ minLength: 1, maxLength: 200, description: 'The problem: its Tracker id, or a title like "Okružno 2019/2020 4. razred A zadatak 3".' }),
});

function createTrackerTool(lookup: (q: string) => { text: string; images?: Array<{ data: string; mimeType: string }> }): AgentTool<typeof trackerInput> {
	return {
		name: "tracker_problem",
		label: "tracker_problem",
		description:
			"Look up a competition problem in the learner's Matematika Tracker archive (DMS: opštinsko … IMO, 2002–2026) and SEE its " +
			"statement (an image). Use it when the learner names an archive problem, so you work on exactly that statement. " +
			"The official solution is not returned — the learner opens it in Zadaci → Arhiva after attempting.",
		parameters: trackerInput,
		execute: serverExecute("tracker_problem", trackerInput, async ({ query }) => lookup(query)),
	};
}

const noInput = Type.Object({});

function createOpenMistakesTool(read: () => string): AgentTool<typeof noInput> {
	return {
		name: "open_mistakes",
		label: "open_mistakes",
		description:
			"The learner's open mistakes in this course (from the mistake log): step, error type, what went wrong, the rule. " +
			"Call it at the start of a session and before reviews; weave the most relevant ones back into your questions. Read-only.",
		parameters: noInput,
		execute: serverExecute("open_mistakes", noInput, async () => read()),
	};
}

const problemListInput = Type.Object({
	scope: Type.Optional(Type.Union([Type.Literal("course"), Type.Literal("all")], { description: "course = problems worked or planned in this course (default); all = the whole log." })),
	category: Type.Optional(Type.String({ description: "Only this category id." })),
	scheduledOnly: Type.Optional(Type.Boolean({ description: "Only entries with a re-solve date." })),
	query: Type.Optional(Type.String({ maxLength: 100, description: "Search in reference, source and note." })),
});

function createProblemListTool(list: (f: ProblemListInput) => string): AgentTool<typeof problemListInput> {
	return {
		name: "problem_log_list",
		label: "problem_log_list",
		description:
			"List the learner's problem log (Zadaci): each entry's id, reference, source, category, last outcome, number of attempts and next re-solve date. " +
			"Read it before changing entries with problem_log_edit, so you edit exactly the ones the learner means.",
		parameters: problemListInput,
		execute: serverExecute("problem_log_list", problemListInput, async (f) => list(f)),
	};
}

const problemEditInput = Type.Object({
	action: Type.Union([Type.Literal("schedule"), Type.Literal("unschedule"), Type.Literal("auto"), Type.Literal("delete"), Type.Literal("plan")], {
		description:
			"schedule = set the re-solve date (id + date); unschedule = no re-solving (id); auto = date follows the last outcome again (id); " +
			"delete = remove the entry and all its attempts (id); plan = put a problem the learner has NOT attempted yet on a day (source + reference + date).",
	}),
	id: Type.Optional(Type.String({ description: "The entry id from problem_log_list (schedule / unschedule / auto / delete)." })),
	date: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD (schedule, plan)." })),
	source: Type.Optional(Type.String({ maxLength: 120, description: "plan: the book or archive, same form as log_problem uses." })),
	reference: Type.Optional(Type.String({ maxLength: 200, description: 'plan: where exactly, e.g. "117b".' })),
	category: Type.Optional(Type.String({ description: "plan: a category id; omit for the course default." })),
	branch: Type.Optional(Type.String({ description: "plan: the area (Algebra, Analiza, …)." })),
	trackerId: Type.Optional(Type.String({ description: "plan: the Matematika Tracker id, for archive problems." })),
	note: Type.Optional(Type.String({ maxLength: 500, description: "plan: one line — what the problem practises." })),
});

function createProblemEditTool(edit: (i: ProblemEditInput) => string, categories: string): AgentTool<typeof problemEditInput> {
	return {
		name: "problem_log_edit",
		label: "problem_log_edit",
		description:
			"Change the learner's problem log (Zadaci) when the learner asks you to: reschedule, stop or restore re-solving, delete an entry, or plan a not-yet-attempted problem for a day " +
			"(it then shows in Za ponovno rešavanje on that day). One change per call; call it once per entry. Never delete on your own initiative. " +
			"Afterwards tell the learner exactly what changed. " +
			(categories ? `Categories: ${categories}.` : ""),
		parameters: problemEditInput,
		execute: serverExecute("problem_log_edit", problemEditInput, async (input) => edit(input)),
	};
}

const makeCardsInput = Type.Object({
	cards: Type.Array(
		Type.Object({
			nodeId: Type.String({ description: "The plan step this card belongs to (an id from the list in this tool's description)." }),
			front: Type.String({ minLength: 1, maxLength: 600, description: 'The question or situation, e.g. "Kako proveriš da li funkcija ima inverznu?". Markdown and LaTeX.' }),
			back: Type.String({ minLength: 1, maxLength: 1500, description: "The answer or the trick, short and complete. Markdown and LaTeX." }),
		}),
		{ minItems: 1, maxItems: 20 },
	),
});

function createMakeCardsTool(make: (cards: MakeCardInput[]) => string, steps: string): AgentTool<typeof makeCardsInput> {
	return {
		name: "make_cards",
		label: "make_cards",
		description:
			"Add flashcards to this course's Kartice deck (spaced repetition; the learner reviews them in Kartice). Use it when the learner asks for cards " +
			"(for example for the tricks or methods you went through), or offer it after a trick is learned. Each card: one idea, a precise front, a short complete back. " +
			"They go straight into the deck as new cards; list them for the learner afterwards. " +
			(steps ? `Plan steps:\n${steps}` : "This course has no plan steps yet, so cards cannot be made."),
		parameters: makeCardsInput,
		execute: serverExecute("make_cards", makeCardsInput, async ({ cards }) => make(cards)),
	};
}
