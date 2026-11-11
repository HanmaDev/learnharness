/**
 * Fork (2026-11-11): side threads made by the fork's own side panel (before
 * v0.6.0, `ChatRecord.sideThreads`) become upstream side threads
 * (`ChatRecord.sideChats`). Pure and idempotent: the store applies it on
 * read, so the next write of the record persists it.
 *
 * Upstream keys a thread by its SEGMENT (sideSegmentId — the first assistant
 * message after a learner input) and keeps at most one thread per segment;
 * the anchor is { messageId: segment, partId: `${segment}-t0`, blockIndex: 0 }
 * (src/server/side-chat.ts). The fork's threads were opened from a panel, so
 * each goes to the segment of the last teacher prose before it started;
 * threads landing in the same segment merge into one (messages in time
 * order), so none becomes unreachable. A thread with no teacher prose before
 * it stays in `sideThreads` — never dropped.
 */
import type { ChatRecord, SideChatMessage, SideChatThread } from "./contracts/chat.ts";
import { SEND_TO_USER_TOOL, sendToUserText } from "./native-messages.ts";
import { sideSegmentId } from "./side-chat.ts";

interface LegacyMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	at: string;
	quote?: string;
	pending?: boolean;
	error?: string;
	savedToNotes?: boolean;
	cardId?: string;
}

interface LegacyThread {
	id: string;
	createdAt: string;
	messages: LegacyMessage[];
}

const isLegacyThread = (t: unknown): t is LegacyThread =>
	!!t && typeof t === "object" && typeof (t as LegacyThread).id === "string" && Array.isArray((t as LegacyThread).messages);

/** The last teacher prose before `at`: its message id and first paragraph. */
function proseBefore(record: ChatRecord, at: number): { messageId: string; text: string } | null {
	let found: { messageId: string; text: string } | null = null;
	for (const m of record.messages) {
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		const when = (m as { timestamp?: number }).timestamp ?? 0;
		if (when > at && found) break;
		for (const b of m.content) {
			const text = b.type === "text" ? b.text : b.type === "toolCall" && b.name === SEND_TO_USER_TOOL ? sendToUserText(b) : undefined;
			if (typeof text === "string" && text.trim()) {
				found = { messageId: m.id, text: text.trim().split(/\n\s*\n/)[0]!.slice(0, 2_000) };
				break;
			}
		}
	}
	return found;
}

function toMessage(m: LegacyMessage): SideChatMessage {
	const base = { id: m.id, role: m.role, text: m.text, at: m.at };
	if (m.role === "user") return { ...base, ...(m.quote ? { quotes: [m.quote] } : {}) };
	return {
		...base,
		...(m.error !== undefined ? { error: m.error } : m.pending ? { error: "Odgovor je prekinut." } : {}),
		...(m.savedToNotes ? { savedToNotes: true } : {}),
		...(m.cardId ? { cardId: m.cardId } : {}),
	};
}

const byTime = (a: SideChatMessage, b: SideChatMessage) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0);

export function migrateLegacySideThreads(record: ChatRecord): ChatRecord {
	const legacy = record.sideThreads;
	if (!Array.isArray(legacy) || legacy.length === 0) return record;
	const threads = (record.sideChats ?? []).map((t) => ({ ...t, messages: [...t.messages] }));
	const bySegment = new Map(threads.map((t) => [t.anchor.messageId, t]));
	const migratedIds = new Set(threads.flatMap((t) => [t.id, ...t.messages.map((m) => m.id)]));
	const kept: unknown[] = [];
	for (const t of legacy) {
		if (!isLegacyThread(t)) {
			kept.push(t);
			continue;
		}
		if (migratedIds.has(t.id)) continue; // already moved (idempotent)
		const at = Date.parse(t.createdAt);
		const prose = proseBefore(record, Number.isFinite(at) ? at : Infinity);
		const segment = prose ? sideSegmentId(record.messages, prose.messageId) : null;
		if (!prose || !segment) {
			kept.push(t); // nothing to hang it on yet: keep it, never drop it
			continue;
		}
		const messages = t.messages.filter((m) => !migratedIds.has(m.id)).map(toMessage);
		const existing = bySegment.get(segment);
		if (existing) {
			existing.messages = [...existing.messages, ...messages].sort(byTime);
		} else {
			const thread: SideChatThread = {
				id: t.id,
				anchor: { messageId: segment, partId: `${segment}-t0`, blockIndex: 0, blockText: prose.text },
				open: false,
				createdAt: t.createdAt,
				messages,
			};
			threads.push(thread);
			bySegment.set(segment, thread);
		}
		migratedIds.add(t.id);
		for (const m of messages) migratedIds.add(m.id);
	}
	const { sideThreads: _legacy, ...rest } = record;
	return { ...rest, sideChats: threads, ...(kept.length ? { sideThreads: kept } : {}) };
}
