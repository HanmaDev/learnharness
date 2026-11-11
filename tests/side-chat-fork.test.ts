/** Fork (2026-11-11): side threads after v0.6.0 — migration of the fork's own
 *  threads, and keeping an answer in the notes or as a card. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { PATHS } from "../config.ts";
import type { ChatRecord, LhMessage } from "../src/core";
import { anchorPointsAtProse } from "../src/core/side-chat.ts";
import { migrateLegacySideThreads } from "../src/core/side-chat-migration.ts";
import { keepSideAnswer, sideThreadStep } from "../src/server/side-keep.ts";
import { chatStore } from "../src/store/chats.ts";

const teacher = (id: string, at: number, text: string, nodeId?: string): LhMessage =>
	({
		id, role: "assistant", stopReason: "stop", timestamp: at,
		content: [{ type: "text", text }, ...(nodeId ? [{ type: "toolCall", id: `q_${id}`, name: "quiz", arguments: { nodeId, question: "Q?" } }] : [])],
	}) as unknown as LhMessage;

describe("legacy side threads → upstream side threads", () => {
	const record = {
		id: "c", title: "t", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", version: 1,
		messages: [teacher("m1", Date.parse("2026-11-01T10:00:00Z"), "Prva lekcija.\n\nDrugi pasus."), teacher("m2", Date.parse("2026-11-01T12:00:00Z"), "Druga lekcija.")],
		sideThreads: [
			{ id: "st_a", title: "x", createdAt: "2026-11-01T11:00:00Z", messages: [
				{ id: "u1", role: "user", text: "Šta je ovo?", at: "2026-11-01T11:00:00Z", quote: "Prva" },
				{ id: "a1", role: "assistant", text: "Odgovor.", at: "2026-11-01T11:00:05Z", savedToNotes: true },
				{ id: "a2", role: "assistant", text: "", at: "2026-11-01T11:01:00Z", pending: true },
			] },
		],
	} as unknown as ChatRecord;

	it("anchors to the last teacher prose before the thread, keeps ids and flags, drops the legacy field", () => {
		const m = migrateLegacySideThreads(record);
		assert.equal("sideThreads" in m, false);
		const [t] = m.sideChats!;
		assert.equal(t!.id, "st_a");
		assert.equal(t!.anchor.messageId, "m1", "started before m2");
		assert.equal(t!.anchor.blockText, "Prva lekcija.");
		assert.ok(anchorPointsAtProse(m.messages, t!.anchor), "upstream accepts the anchor");
		assert.deepEqual(t!.messages[0], { id: "u1", role: "user", text: "Šta je ovo?", at: "2026-11-01T11:00:00Z", quotes: ["Prva"] });
		assert.equal(t!.messages[1]!.savedToNotes, true);
		assert.equal(t!.messages[2]!.error, "Odgovor je prekinut.", "an answer cut by a restart reads as interrupted");
		assert.deepEqual(migrateLegacySideThreads(m), m, "idempotent");
		assert.deepEqual(migrateLegacySideThreads({ ...m, sideThreads: record.sideThreads }).sideChats!.length, 1, "never duplicated");
		assert.equal(t!.anchor.partId, "m1-t0", "upstream's segment anchor shape");
	});

	it("restored panel: threads in one segment stay separate topics with their open/closed state; one with no teacher prose is kept", () => {
		const user = { id: "u0", role: "user", content: "hi", timestamp: Date.parse("2026-11-01T09:00:00Z") } as unknown as LhMessage;
		const rec = {
			...record,
			messages: [user, teacher("m1", Date.parse("2026-11-01T10:00:00Z"), "Lekcija."), teacher("m2", Date.parse("2026-11-01T10:30:00Z"), "Nastavak.")],
			sideThreads: [
				{ id: "st_1", createdAt: "2026-11-01T10:10:00Z", messages: [{ id: "q1", role: "user", text: "Prvo?", at: "2026-11-01T10:10:00Z" }] },
				{ id: "st_2", createdAt: "2026-11-01T10:40:00Z", closed: true, messages: [{ id: "q2", role: "user", text: "Drugo?", at: "2026-11-01T10:40:00Z" }] },
			],
		} as unknown as ChatRecord;
		const m = migrateLegacySideThreads(rec);
		assert.deepEqual(m.sideChats!.map((t) => t.id), ["st_1", "st_2"], "one segment, two topics");
		assert.equal(m.sideChats![0]!.anchor.messageId, m.sideChats![1]!.anchor.messageId);
		assert.deepEqual(m.sideChats!.map((t) => t.open), [true, false], "the old panel's closed flag");
		assert.deepEqual(m.sideChats!.map((t) => t.messages.map((x) => x.id)), [["q1"], ["q2"]]);
		assert.deepEqual(migrateLegacySideThreads(m), m, "idempotent");

		const bare = { ...record, messages: [], sideThreads: record.sideThreads } as unknown as ChatRecord;
		const kept = migrateLegacySideThreads(bare);
		assert.equal(kept.sideChats!.length, 0);
		assert.equal((kept.sideThreads as unknown[]).length, 1, "kept in the legacy field until it can be placed");
	});
});

describe("keeping a side answer", () => {
	const chat = chatStore.createChat("side keep test");
	after(() => fs.rmSync(path.join(PATHS.chats, `${chat.id}.json`), { force: true }));

	it("saves into the step's notes, or makes an explain card, once; the plan step comes from the anchor", () => {
		const rec = chatStore.getChat(chat.id)!;
		chatStore.saveMessages(chat.id, [teacher("m1", 1, "Lekcija o inverznim.", "inv"), teacher("m2", 2, "Dalje.", "par")] as never);
		chatStore.saveTree(chat.id, { nodes: [{ id: "par", title: "Parnost" }, { id: "inv", title: "Inverzne" }], edges: [], version: 1 } as never);
		chatStore.updateSideChats(chat.id, () => [{
			id: "th", open: false, createdAt: "t",
			anchor: { messageId: "m1", partId: "m1-t0", blockIndex: 0, blockText: "Lekcija o inverznim." },
			messages: [
				{ id: "u", role: "user", text: "Kako se nalazi inverzna?", at: "t", quotes: ["Lekcija"] },
				{ id: "a", role: "assistant", text: "Rešiš po x.", at: "t" },
			],
		}]);
		assert.equal(sideThreadStep(chatStore.getChat(chat.id)!, "m1"), "inv");
		assert.equal(rec.id, chat.id);

		assert.deepEqual(keepSideAnswer(chat.id, "th", "a", "notes"), { ok: true });
		assert.deepEqual(keepSideAnswer(chat.id, "th", "a", "card"), { ok: true });
		assert.deepEqual(keepSideAnswer(chat.id, "th", "a", "card"), { ok: true }, "a second click changes nothing");
		const after = chatStore.getChat(chat.id)!;
		assert.equal(after.notes?.extras?.inv?.length, 1);
		assert.match(after.notes!.extras!.inv![0]!.markdown, /Rešiš po x\./);
		assert.equal(after.cards?.generated?.length, 1);
		const card = after.cards!.generated![0]!;
		assert.equal(card.tool, "explain");
		assert.equal(card.nodeId, "inv");
		assert.match(String(card.args.question), /> Lekcija[\s\S]*Kako se nalazi inverzna\?/);
		const msg = after.sideChats![0]!.messages[1]!;
		assert.equal(msg.savedToNotes, true);
		assert.equal(msg.cardId, card.id);
		assert.equal(keepSideAnswer(chat.id, "th", "u", "notes").ok, false, "only answers can be kept");
	});
});
