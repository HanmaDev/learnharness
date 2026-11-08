/**
 * Topic notes (fork, 2026-11-08) — the server side: the background writer,
 * the notes file in the learner's folder, and the view the notes page reads.
 *
 * The writer runs after a teaching turn (debounced) for every taught step
 * that changed and is no longer the one being taught, or on request for all
 * of them. Notes are written by the teacher-slot model, never shown to the
 * teacher, and stored in ChatRecord.notes (so the data backups carry them)
 * plus the readable .md file in the notes folder.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { runSubagent } from "../agent/subagents/pi-run.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import {
	derivePlanStatusesLh,
	emit,
	nodeMessages,
	nodeWindows,
	notesDocument,
	notesFileName,
	noteSteps,
	sessionMarkdown,
	staleSteps,
	toSerbianLatin,
	type ChatRecord,
	type CourseNotes,
	type NoteExtra,
	type NoteStepView,
} from "../core";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { readSettings } from "../store/settings.ts";
import { resolveEngine } from "./chat-handler.ts";
import { stores } from "./stores.ts";

/** Where the notes files go: the settings value, else Documents/Ucenje/Beleske
 *  when the Ucenje folder exists, else Documents/LearnHarness-beleske. */
export function notesFolder(): string {
	const set = (readSettings()?.notes as { folder?: unknown } | undefined)?.folder;
	if (typeof set === "string" && set.trim()) return set.trim();
	const docs = path.join(os.homedir(), "Documents");
	const ucenje = path.join(docs, "Ucenje");
	return fs.existsSync(ucenje) ? path.join(ucenje, "Beleske") : path.join(docs, "LearnHarness-beleske");
}

function currentStep(chat: ChatRecord): string | null {
	return chat.tree ? derivePlanStatusesLh(chat.tree, chat.messages).current : null;
}

export function courseTitleOf(chat: ChatRecord): string {
	return chat.notes?.courseTitle ?? toSerbianLatin(chat.title).slice(0, 60);
}

export function notesFilePath(chat: ChatRecord): string {
	return path.join(notesFolder(), notesFileName(courseTitleOf(chat)));
}

export interface CourseNotesView {
	chatId: string;
	courseTitle: string;
	filePath: string;
	steps: NoteStepView[];
	/** Steps being written right now. */
	writing: string[];
	error: string | null;
}

// ─── The writer queue (one per course, in memory) ──────────────────────────

const writing = new Map<string, Set<string>>();
const lastError = new Map<string, string>();
const debounce = new Map<string, ReturnType<typeof setTimeout>>();

export function notesView(chat: ChatRecord): CourseNotesView {
	const steps = chat.tree ? noteSteps(chat.tree, chat.messages, chat.notes, currentStep(chat)) : [];
	return {
		chatId: chat.id,
		courseTitle: courseTitleOf(chat),
		filePath: notesFilePath(chat),
		steps,
		writing: [...(writing.get(chat.id) ?? [])],
		error: lastError.get(chat.id) ?? null,
	};
}

const WRITER_SYSTEM = `You write a student's study notes for one step of a course, from the lesson transcript of that step.
The notes are what the student re-reads before the exam instead of scrolling the chat. Write in Serbian, Latin script only.
Keep every concept, definition, rule, example and piece of code that was taught for THIS step, organised and tidy:
short paragraphs, **bold** key terms with one-line definitions, bullet lists for enumerations, fenced code blocks for code/HTML/SQL/CSS (verbatim), tables where they help.
End with a "### Pitanja iz lekcije" section: each question the teacher asked for this step in bold, followed by the correct answer and the one-line reason (not the student's answer, not chit-chat).
Leave out greetings, pacing talk, meta comments about the lesson, anything that belongs to other steps, and anything not actually taught. Do not invent material.
Do NOT start with a heading for the step (the app adds it). Output only the Markdown body.`;

function writerPrompt(chat: ChatRecord, step: NoteStepView, transcript: string, needTitle: boolean): string {
	const node = chat.tree?.nodes.find((n) => n.id === step.id);
	return [
		`Course: ${toSerbianLatin(chat.title)}`,
		`Step ${step.number}: ${step.title}${node?.summary ? ` — ${toSerbianLatin(node.summary)}` : ""}`,
		needTitle ? 'FIRST LINE of your reply: "Naziv kursa: <a short 1-4 word course name, e.g. Veb dizajn>", then a blank line, then the notes.' : "",
		step.markdown ? `\nThe current notes for this step (update and extend them; keep what is still right):\n\n<<<\n${step.markdown}\n>>>` : "",
		`\nThe lesson transcript for this step:\n\n<<<\n${transcript}\n>>>`,
	]
		.filter(Boolean)
		.join("\n");
}

/** Keep the transcript within a sane prompt size (the latest part matters most). */
const MAX_TRANSCRIPT_CHARS = 60_000;

async function writeStep(chatId: string, stepId: string): Promise<void> {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat?.tree) return;
	const steps = noteSteps(chat.tree, chat.messages, chat.notes, currentStep(chat));
	const step = steps.find((s) => s.id === stepId);
	const windows = nodeWindows(chat.tree, chat.messages).get(stepId);
	if (!step || !windows) return;
	const slice = nodeMessages(windows, chat.messages);
	let transcript = sessionMarkdown(slice, { anchors: false });
	if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
	const engine = resolveEngine("teacher");
	if (!engine) throw new Error("Nije podešen model (Settings → Providers).");
	const needTitle = !chat.notes?.courseTitle;
	const { text } = await withBgLlmSlot(undefined, () =>
		runSubagent([], { role: "teacher", engine, systemPrompt: WRITER_SYSTEM, prompt: writerPrompt(chat, step, transcript, needTitle), maxTurns: 1, chatId }),
	);
	let body = text.trim();
	let title: string | undefined;
	const m = /^\s*Naziv kursa:\s*(.+)\n/i.exec(body);
	if (m) {
		title = toSerbianLatin(m[1]!.trim().replace(/^["„“]|["”“]$/g, "")).slice(0, 60);
		body = body.slice(m[0].length).trim();
	}
	if (!body) throw new Error("Prazne beleške.");
	const coveredTo = (chat.messages[windows.at(-1)![1]] as { id?: string }).id ?? "";
	stores.chatStore.updateNotes(chatId, (n) => {
		(n.sections ??= {})[stepId] = { markdown: toSerbianLatin(body), coveredTo, updatedAt: new Date().toISOString() };
		if (title && !n.courseTitle) n.courseTitle = title;
	});
	writeNotesFile(chatId);
}

/** Rewrite the course's .md file from the stored sections. */
export function writeNotesFile(chatId: string): string | null {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat?.tree) return null;
	const file = notesFilePath(chat);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, notesDocument(courseTitleOf(chat), noteSteps(chat.tree, chat.messages, chat.notes, currentStep(chat))));
	return file;
}

/** Write the given steps one after another (skips steps already in flight). */
export function runNotes(chatId: string, stepIds: readonly string[]): void {
	const active = writing.get(chatId) ?? new Set<string>();
	const todo = stepIds.filter((id) => !active.has(id));
	if (todo.length === 0) return;
	for (const id of todo) active.add(id);
	writing.set(chatId, active);
	emit("record-changed", { chatId });
	void (async () => {
		lastError.delete(chatId);
		for (const id of todo) {
			try {
				await writeStep(chatId, id);
			} catch (e) {
				lastError.set(chatId, e instanceof Error ? e.message : String(e));
				console.warn(`[notes] ${chatId}/${id}: ${lastError.get(chatId)}`);
			} finally {
				active.delete(id);
				emit("record-changed", { chatId });
			}
		}
	})();
}

/** After a teaching turn: write the steps the lesson has moved past. */
export function scheduleNotes(chatId: string, delayMs = 20_000): void {
	clearTimeout(debounce.get(chatId));
	debounce.set(
		chatId,
		setTimeout(() => {
			debounce.delete(chatId);
			const chat = stores.chatStore.getChat(chatId);
			if (!chat?.tree || chat.kind === "practice" || readSettings()?.notes?.["enabled" as never] === false) return;
			const steps = noteSteps(chat.tree, chat.messages, chat.notes, currentStep(chat));
			runNotes(chatId, staleSteps(steps));
		}, delayMs),
	);
}

/** "Ažuriraj beleške": every taught step that is out of date, the current one too. */
export function refreshNotes(chatId: string): number {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat?.tree) return 0;
	const ids = staleSteps(noteSteps(chat.tree, chat.messages, chat.notes, currentStep(chat)), true);
	runNotes(chatId, ids);
	return ids.length;
}

/** "Sačuvaj u beleške" from a side thread. */
export function addNoteExtra(chatId: string, stepId: string, extra: Omit<NoteExtra, "id" | "at" | "source">): void {
	stores.chatStore.updateNotes(chatId, (n) => {
		const list = ((n.extras ??= {})[stepId] ??= []);
		list.push({ id: `x_${Date.now().toString(36)}`, at: new Date().toISOString(), source: "side", ...extra });
	});
	writeNotesFile(chatId);
}

/** Show the notes file in Explorer / Finder (never runs it). */
export function revealNotesFile(chatId: string): boolean {
	const file = writeNotesFile(chatId);
	if (!file) return false;
	const cmd = process.platform === "win32" ? ["explorer.exe", [`/select,${file}`]] : process.platform === "darwin" ? ["open", ["-R", file]] : ["xdg-open", [path.dirname(file)]];
	spawn(cmd[0] as string, cmd[1] as string[], { detached: true, stdio: "ignore" }).unref();
	return true;
}

export type { CourseNotes };
