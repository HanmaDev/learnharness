/** Fork (2026-11-11): side questions are private — the teacher never receives them. */
import assert from "node:assert/strict";
import { it } from "node:test";

it("side conversations do not reach the teacher unless explicitly switched on", async () => {
	delete process.env.LH_SIDE_CHATS_REACH_TEACHER;
	const { sideChatsReachTeacher } = await import("../src/server/chat-handler.ts");
	assert.equal(sideChatsReachTeacher(), false);
});

it("the side helper is told the conversation is private", async () => {
	const fs = await import("node:fs");
	const prompt = fs.readFileSync(new URL("../src/agent/prompts/side-chat/00-base.md", import.meta.url), "utf8");
	assert.match(prompt, /main teacher never sees it/);
	assert.doesNotMatch(prompt, /main teacher receives/);
});
