/**
 * Fork (restored 2026-11-11): the old side-question panel on v0.6.0's side
 * chats — topic titles, open vs closed topics, the header chip, and the
 * reducer opening a NEW topic under its own id.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SideChip, sideTopics, sideTopicTitle } from "../components/side-chat/side-panel.tsx";
import { sideThreadReducer } from "../components/use-side-thread.ts";
import type { SideChatThread } from "../src/core/index.ts";

const thread = (id: string, open: boolean, first?: string, at = "2026-11-11T10:00:00.000Z"): SideChatThread => ({
	id, open, createdAt: at,
	anchor: { messageId: "msg_a", partId: "msg_a-t0", blockIndex: 0, blockText: "x" },
	messages: first ? [{ id: `${id}_u`, role: "user", text: first, at }, { id: `${id}_a`, role: "assistant", text: "answer", at }] : [],
});

describe("restored side panel", () => {
	it("titles a topic by its first question, clipped to one line", () => {
		assert.equal(sideTopicTitle(thread("a", true, "Šta je JOIN?")), "Šta je JOIN?");
		assert.equal(sideTopicTitle(thread("a", true, "prvi red\ndrugi red")), "prvi red");
		assert.equal(sideTopicTitle(thread("a", true, "x".repeat(60))), `${"x".repeat(40)}…`);
		assert.equal(sideTopicTitle(thread("a", true)), "Pitanje");
	});

	it("splits asked topics into open tabs and closed ones, oldest first; empty threads are not topics", () => {
		const t = sideTopics([
			thread("late", true, "b", "2026-11-11T12:00:00.000Z"),
			thread("closed", false, "c"),
			thread("early", true, "a", "2026-11-11T09:00:00.000Z"),
			thread("empty", true),
		]);
		assert.deepEqual(t.open.map((x) => x.id), ["early", "late"]);
		assert.deepEqual(t.closed.map((x) => x.id), ["closed"]);
	});

	it("the header chip reads Sa strane with the open count", () => {
		assert.match(renderToStaticMarkup(<SideChip count={2} active={false} onClick={() => {}} />), /Sa strane 2/);
		assert.match(renderToStaticMarkup(<SideChip count={0} active onClick={() => {}} />), /Sa strane<\/button>/);
	});

	it("a fresh topic opens under its own id even when the segment already has a thread", () => {
		const existing = thread("side_msg_a", true, "q");
		const opened = sideThreadReducer(null, { type: "open", segmentId: "msg_a", anchor: { kind: "composer" }, thread: existing });
		assert.equal(opened?.threadId, "side_msg_a");
		const fresh = sideThreadReducer(opened, { type: "open", segmentId: "msg_a", anchor: { kind: "composer" }, threadId: "side_new_1", fresh: true });
		assert.equal(fresh?.threadId, "side_new_1");
		assert.equal(fresh?.fresh, true);
		assert.deepEqual(fresh?.messages, []);
	});
});
