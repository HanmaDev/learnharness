/**
 * Fork (2026-11-11): side threads made by the fork's own side panel (before
 * v0.6.0, `ChatRecord.sideThreads`) become upstream side threads
 * (`ChatRecord.sideChats`). Pure and idempotent: the store applies it on read,
 * so the next write of the record persists it. Ids are kept, so a thread is
 * never duplicated, and the legacy field disappears once migrated.
 *
 * Upstream threads hang off a teacher passage (an anchor); the fork's were
 * opened from a panel, so each anchors to the last teacher prose before it
 * started — its speech bubble then sits where the question was asked.
 */
import type { ChatRecord, SideChatMessage, SideChatThread } from "./contracts/chat.ts";
import { SEND_TO_USER_TOOL, sendToUserText } from "./native-messages.ts";

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

/** The last teacher prose before `at`: its message, first prose part and text. */
function anchorBefore(record: ChatRecord, at: number): SideChatThread["anchor"] | null {
	let found: SideChatThread["anchor"] | null = null;
	for (const m of record.messages) {
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		const when = (m as { timestamp?: number }).timestamp ?? 0;
		if (when > at && found) break;
		// projectView numbers a message's prose parts t0, t1, …: text blocks
		// and send_to_user messages, in order. The first one is the anchor.
		for (const b of m.content) {
			const text = b.type === "text" ? b.text : b.type === "toolCall" && b.name === SEND_TO_USER_TOOL ? sendToUserText(b) : undefined;
			if (typeof text === "string" && text.trim()) {
				found = { messageId: m.id, partId: `${m.id}-t0`, blockIndex: 0, blockText: text.trim().split(/\n\s*\n/)[0]!.slice(0, 2_000) };
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

export function migrateLegacySideThreads(record: ChatRecord): ChatRecord {
	const legacy = record.sideThreads;
	if (!Array.isArray(legacy) || legacy.length === 0) return record;
	const existing = new Set((record.sideChats ?? []).map((t) => t.id));
	const moved: SideChatThread[] = [];
	for (const t of legacy) {
		if (!isLegacyThread(t) || existing.has(t.id)) continue;
		const at = Date.parse(t.createdAt);
		const anchor = anchorBefore(record, Number.isFinite(at) ? at : Infinity);
		if (!anchor) continue; // no teacher prose at all — nothing to hang it on
		moved.push({ id: t.id, anchor, open: false, createdAt: t.createdAt, messages: t.messages.map(toMessage) });
	}
	const { sideThreads: _legacy, ...rest } = record;
	return { ...rest, sideChats: [...(record.sideChats ?? []), ...moved] };
}
