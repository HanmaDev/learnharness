/**
 * ChatStore — the fs JSON adapter (one file per chat in data/chats/).
 *
 * Implements core/ports.ts ChatStore; the record shapes live in
 * core/contracts.ts (ChatRecord/ChatSummary). Idioms: sync fs, tiny
 * records, id-guarded filenames, JSON with tab indentation. Wired in the
 * composition root (src/server/stores.ts); nothing else constructs it.
 */

import type { CourseMistakes } from "../core/mistakes.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { ChatStore } from "../core/ports.ts";
import type { ChatRecord, ChatSettings, ChatSummary, ExtractionRunUsage, ImageSnapshot, PlanTree, SideChatThread, TurnUsage } from "../core/contracts.ts";
import { deriveDoneNodes, type PlanTarget } from "../core/plan-progress.ts";
import { CURRENT_CHAT_VERSION } from "../core/contracts.ts";
import type { LhMessage } from "../core/native-messages.ts";
import type { CourseCards } from "../core/cards.ts";
import type { CourseNotes } from "../core/notes.ts";
import { activeProblemOf, danglingQuestionOf } from "../core/native-messages.ts";
import { phaseAt3Lh } from "../core/phases.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

function chatFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
	return path.join(/* turbopackIgnore: true */ PATHS.chats, `${id}.json`);
}

/** THE SILENCE LAW (push S6, 2026-10-02): chats-changed announces ONLY
 *  list-SHAPE mutations — createChat, renameChat, deleteChat (below,
 *  each emits post-write). The content writers (saveMessages,
 *  appendTurnUsage, appendExtractionUsage, saveSettings, saveTree) are
 *  DELIBERATELY SILENT: saveMessages fires per turn-persist and would
 *  spam the bus, and every list-visible change it causes (title, order,
 *  phase, busy, pendingQuestion) is already announced by turn-started /
 *  turn-settled, which the sidebar refetches on. Silence here is law,
 *  not oversight. */
function createChat(title: string, kind?: "practice"): ChatRecord {
	const now = new Date().toISOString();
	const record: ChatRecord = {
		id: `chat_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: title.trim() || "Untitled session",
		createdAt: now,
		updatedAt: now,
		messages: [],
		// Practice sessions carry the marker; teach stays ABSENT (absence
		// reads as teach — pre-practice records never migrate).
		...(kind === "practice" ? { kind: "practice" as const } : {}),
	};
	fs.mkdirSync(PATHS.chats, { recursive: true });
	writeChat(record);
	emit("chats-changed", {});
	return { ...record, version: CURRENT_CHAT_VERSION }; // the in-memory twin of what landed on disk
}

/** THE WRITE CHOKE POINT (schema-versioning wave, owner 2026-10-10): every
 *  record persist goes through here and carries the CURRENT version stamp —
 *  lazy migration means existing files only get stamped on their next write.
 *  A future-version guard lives on the read side (getChat). */
function writeChat(record: ChatRecord): void {
	writeFileAtomicSync(chatFile(record.id), JSON.stringify({ ...record, version: CURRENT_CHAT_VERSION }, null, "\t"), { allowInPlaceFallback: true });
}

function getChat(id: string): ChatRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ chatFile(id), "utf-8"));
	} catch {
		return null;
	}
	// Honest refusal (owner ruling 2026-10-10): a record stamped NEWER than
	// this build (the downgrade scenario) reads as absent, never misparsed —
	// the next read-modify-write must not rewrite what it doesn't understand.
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_CHAT_VERSION) {
		console.error(`[chat ${id}] record stamped with schema version ${v} > ${CURRENT_CHAT_VERSION} — this app build is older; refusing to read it`);
		return null;
	}
	return parsed as ChatRecord;
}

function listChats(): ChatSummary[] {
	try {
		fs.mkdirSync(PATHS.chats, { recursive: true });
		return fs
			.readdirSync(/* turbopackIgnore: true */ PATHS.chats)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getChat(f.slice(0, -5)))
			.filter((r): r is ChatRecord => r !== null)
			.map(({ messages, tree, turns, extractions, imageSnapshots: _imageSnapshots, cards: _cards, notes: _notes, sideThreads: _sideThreads, mistakes: _mistakes, sideChats: _sideChats, ...summary }) => {
				// Per-record isolation (Wave B): a record whose messages fail the
				// projection (e.g. pre-Wave-B UIMessage-format scratch — the
				// zero-back-compat wipe makes these "corrupt") must not blank the
				// whole sidebar — same isolation getChat's per-file catch gives.
				try {
					return {
						// turns and extractions stay out of the list payload (list =
						// summaries; usage aggregates ride the full record, the picker
						// never needs them).
						...summary,
						// Normalized kind: absent record field reads as teach.
						kind: summary.kind ?? "teach",
						messageCount: messages.length,
						// Record-derived status for the session picker: phase from the
						// transcript's explicit events (probe_done concluded / verdict
						// accepted — docs/archive/probe-teach-split.md §4), pending question
						// from the native dangling-call scan. Wave D: both folds read
						// the NATIVE record (core/phases.ts phaseAt3Lh +
						// native-messages.ts danglingQuestionOf). Liveness (busy) is
						// NOT record-derived — the API route merges it (ChatListItem).
						phase: phaseAt3Lh(messages),
						pendingQuestion: danglingQuestionOf(messages) !== null,
						// Practice: a posed problem with no conclude (the sidebar's
						// "Problem waiting"); false on teaching sessions, which
						// have no problem tool.
						pendingProblem: activeProblemOf(messages) !== null,
						// Fork: the sidebar's progress badge.
						...(tree && tree.nodes.length > 0
							? { planPercent: Math.round((deriveDoneNodes(tree, messages).size / tree.nodes.length) * 100) }
							: {}),
					};
				} catch (err) {
					console.error(`[chat ${summary.id}] summary projection failed:`, err);
					return null;
				}
			})
			.filter((s) => s !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** Persist the full native message list (the record IS the agent state —
 *  Wave B: replay is state.messages = record.messages). SILENT by the
 *  events law — see the SILENCE LAW comment at createChat. */
function saveMessages(id: string, messages: LhMessage[]): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	// Side-delivery watermarks are part of the appended native entries,
	// so input + updates commit together without mutating thread history.
	record.messages = messages;
	record.updatedAt = new Date().toISOString();
	writeChat(record);
}

/** A synchronous read/merge/write keeps concurrent worker and turn writes from losing snapshots. */
function saveImageSnapshot(id: string, snapshotId: string, image: ImageSnapshot): void {
	if (!/^[a-f0-9]{64}$/.test(snapshotId) || createHash("sha256").update(Buffer.from(image.data, "base64")).digest("hex") !== snapshotId) {
		throw new Error("Invalid image snapshot identity");
	}
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	if (record.imageSnapshots?.[snapshotId]) return;
	record.imageSnapshots = { ...record.imageSnapshots, [snapshotId]: {
		mimeType: image.mimeType, data: image.data, width: image.width, height: image.height,
	} };
	writeChat(record);
}

/** Append one usage entry to the record's turn log — idempotent per
 * turn id: each REQUEST carries its own id, so a replay of the same turn's
 * persist appends once, while continuation turns (which share a response
 *  message id) each keep their usage. */
function appendTurnUsage(id: string, entry: TurnUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.turns = record.turns?.some((t) => t.id === entry.id)
		? record.turns
		: [...(record.turns ?? []), entry];
	writeChat(record);
}

/** Append one extraction-run usage entry to the record's extractions
 * log — idempotent per startedAt: a retry that reaches the append twice
 * (abort replays) does not double-count spend. */
function appendExtractionUsage(id: string, entry: ExtractionRunUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.extractions = record.extractions?.some((r) => r.startedAt === entry.startedAt)
		? record.extractions
		: [...(record.extractions ?? []), entry];
	writeChat(record);
}

/** Persist the per-chat model/thinking settings — replace-whole (the
 * picker sends the complete object; absent = config defaults). */
function saveSettings(id: string, settings: ChatSettings): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	// Like saveTree: a settings tweak is not conversation activity, so it
	// deliberately does NOT bump updatedAt (sidebar order must not churn).
	record.settings = settings;
	writeChat(record);
}

/** Rename a session (the header's click-to-edit title, 2026-09-17). Like
 * saveSettings, a rename is NOT conversation activity: updatedAt stays put
 * so sidebar order never churns. Same fallback as createChat — the empty
 * string becomes "Untitled session" (the API gate rejects it first; this
 * is the honest floor for any other caller). */
function renameChat(id: string, title: string): ChatRecord {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.title = title.trim() || "Untitled session";
	writeChat(record);
	emit("chats-changed", {});
	return record;
}

/** Delete the session record file entirely (session-deletion wave 6,
 *  owner 2026-09-22). False when the id is unknown — the route turns that
 *  into a 404. The record's graph traces and jobs are the route's
 *  choreography (core/graph-deletion.ts), not the store's. */
function deleteChat(id: string): boolean {
	try {
		fs.unlinkSync(chatFile(id));
		removeLeftoverTemps(chatFile(id));
		emit("chats-changed", {}); // only a real removal — the present-entry law
		return true;
	} catch {
		return false; // never existed, already deleted, or unreadable — same answer
	}
}

/** Persist the session plan tree (plan tools call this in execute). */
function saveTree(id: string, tree: PlanTree): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.tree = tree;
	// Deliberately does NOT bump updatedAt: tree mutations piggyback on the
	// turn's saveMessages, and sidebar ordering shouldn't churn on tree edits.
	writeChat(record);
}

/** Fork: an uploaded photo nobody submitted is kept this long, then pruned. */
const STALE_UPLOAD_MS = 24 * 60 * 60_000;

/** Is this snapshot id referenced anywhere in the record's messages? Ids are
 *  64-hex sha256 digests, so a substring scan cannot collide by accident. */
function photoInUse(record: ChatRecord, snapshotId: string): boolean {
	return JSON.stringify(record.messages).includes(snapshotId);
}

/** Drop stale, unused learner uploads (never show_image snapshots: only ids
 *  in photoUploads are candidates). Mutates the record; returns whether it changed. */
function pruneStaleUploads(record: ChatRecord, now = Date.now()): boolean {
	const uploads = record.photoUploads;
	if (!uploads) return false;
	let changed = false;
	for (const [snapshotId, at] of Object.entries(uploads)) {
		const inUse = photoInUse(record, snapshotId);
		if (inUse) {
			delete uploads[snapshotId]; // submitted: a normal session snapshot from now on
			changed = true;
		} else if (now - Date.parse(at) > STALE_UPLOAD_MS) {
			delete uploads[snapshotId];
			if (record.imageSnapshots?.[snapshotId]) delete record.imageSnapshots[snapshotId];
			changed = true;
		}
	}
	return changed;
}

function savePhotoUpload(id: string, snapshotId: string, image: ImageSnapshot): void {
	saveImageSnapshot(id, snapshotId, image);
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	pruneStaleUploads(record);
	if (!photoInUse(record, snapshotId)) record.photoUploads = { ...record.photoUploads, [snapshotId]: new Date().toISOString() };
	writeChat(record);
}

function removeUnusedPhoto(id: string, snapshotId: string): boolean {
	const record = getChat(id);
	if (!record || !record.photoUploads?.[snapshotId] || photoInUse(record, snapshotId)) return false;
	delete record.photoUploads[snapshotId];
	if (record.imageSnapshots?.[snapshotId]) delete record.imageSnapshots[snapshotId];
	writeChat(record);
	return true;
}

/** Fork: the plan's target date. Like saveTree, not conversation activity
 *  (updatedAt stays put). A synchronous read/merge/write, so a turn's later
 *  saveMessages keeps it. */
function savePlanTarget(id: string, target: PlanTarget | null): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	if (target) {
		record.planTarget = target;
		delete record.planTargetClearedAt;
	} else if (record.planTarget) {
		delete record.planTarget;
		record.planTargetClearedAt = new Date().toISOString();
	}
	writeChat(record);
}

/** Fork: change a course's card data (reviews, switches, generated cards).
 *  Not conversation activity (updatedAt stays put); a synchronous
 *  read/merge/write, so a turn's later saveMessages keeps it. */
function updateCards(id: string, change: (cards: CourseCards) => void): CourseCards {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	const cards: CourseCards = record.cards ?? {};
	change(cards);
	record.cards = cards;
	writeChat(record);
	return cards;
}

/** Fork: change a course's notes (same read/merge/write discipline). */
function updateNotes(id: string, change: (notes: CourseNotes) => void): CourseNotes {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	const notes: CourseNotes = record.notes ?? {};
	change(notes);
	record.notes = notes;
	writeChat(record);
	return notes;
}

/** Fork: change a course's mistake log (same discipline). */
function updateMistakes(id: string, change: (mistakes: CourseMistakes) => void): CourseMistakes {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	const mistakes: CourseMistakes = record.mistakes ?? {};
	change(mistakes);
	record.mistakes = mistakes;
	writeChat(record);
	return mistakes;
}

/** Fork: the ids of every chat file (no parsing). */
function listChatIds(): string[] {
	try {
		return fs.readdirSync(PATHS.chats).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
	} catch {
		return [];
	}
}

/** Side-question threads (2026-11-02): one synchronous read-modify-write,
 *  so a concurrent turn's saveMessages (which re-reads the record) never
 *  loses a thread and a thread write never loses messages. Null when the
 *  chat is gone (a side answer finishing after session deletion). Silent
 *  and not conversation activity, like saveSettings. */
function updateSideChats(id: string, update: (threads: SideChatThread[]) => SideChatThread[]): SideChatThread[] | null {
	const record = getChat(id);
	if (!record) return null;
	const next = update(record.sideChats ?? []);
	if (next.length > 0) record.sideChats = next;
	else delete record.sideChats;
	writeChat(record);
	return next;
}

export const chatStore: ChatStore = {
	createChat,
	getChat,
	listChats,
	saveMessages,
	saveImageSnapshot,
	savePhotoUpload,
	removeUnusedPhoto,
	saveTree,
	savePlanTarget,
	updateCards,
	listChatIds,
	updateNotes,
	updateMistakes,
	saveSettings,
	renameChat,
	deleteChat,
	appendTurnUsage,
	appendExtractionUsage,
	updateSideChats,
};
