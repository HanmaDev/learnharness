/** Fork (2026-11-09): the teacher manages Zadaci and makes cards on request. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { PATHS } from "../config.ts";
import { chatStore } from "../src/store/chats.ts";
import { logAttempt, problemLog } from "../src/server/problems.ts";
import { makeCardsFor, planStepsText, problemEditFor, problemListText } from "../src/server/teacher-records.ts";
import { resolveDate } from "../src/core/problems.ts";

const file = path.join(PATHS.data, "problems.json");
let saved: Buffer | null = null;
const chat = chatStore.createChat("teacher records test");
const other = chatStore.createChat("teacher records other");

before(() => {
	saved = fs.existsSync(file) ? fs.readFileSync(file) : null;
	if (saved) fs.unlinkSync(file);
	chatStore.saveTree(chat.id, { nodes: [{ id: "inv", title: "Инверзне функције" }], edges: [], version: 1 } as never);
});

after(() => {
	if (saved) fs.writeFileSync(file, saved);
	else if (fs.existsSync(file)) fs.unlinkSync(file);
	for (const c of [chat, other]) fs.rmSync(path.join(PATHS.chats, `${c.id}.json`), { force: true });
});

describe("teacher: problem log", () => {
	it("lists this course's entries with ids, and edits them by id", () => {
		const a = logAttempt({ source: "Zbirka", reference: "92z", outcome: "read", chatId: chat.id }).entry;
		logAttempt({ source: "Zbirka", reference: "93k", outcome: "hint", chatId: other.id });
		const list = problemListText(chat.id, {});
		assert.match(list, new RegExp(`id ${a.id}`));
		assert.doesNotMatch(list, /93k/, "another course's entry is not in scope course");
		assert.match(problemListText(chat.id, { scope: "all" }), /93k/);

		assert.match(problemEditFor(chat.id, { action: "schedule", id: a.id, date: "2026-12-01" }), /2026-12-01/);
		assert.equal(resolveDate(problemLog().entries.find((e) => e.id === a.id)!), "2026-12-01");
		problemEditFor(chat.id, { action: "unschedule", id: a.id });
		assert.equal(resolveDate(problemLog().entries.find((e) => e.id === a.id)!), null);
		problemEditFor(chat.id, { action: "auto", id: a.id });
		assert.notEqual(resolveDate(problemLog().entries.find((e) => e.id === a.id)!), null, "back to the outcome rule");
		assert.match(problemEditFor(chat.id, { action: "delete", id: a.id }), /Deleted "92z"/);
		assert.equal(problemLog().entries.some((e) => e.id === a.id), false);
		assert.match(problemEditFor(chat.id, { action: "delete", id: "nope" }), /No entry/);
		assert.match(problemEditFor(chat.id, { action: "schedule", id: "x" }), /date|No entry/);
	});

	it("plans an unattempted problem for a day; its first attempt makes it ordinary", () => {
		assert.match(problemEditFor(chat.id, { action: "plan", source: "Zbirka", reference: "117b", date: "2026-11-16" }), /Planned "117b"/);
		const planned = problemLog().entries.find((e) => e.reference === "117b")!;
		assert.equal(planned.attempts.length, 0);
		assert.equal(resolveDate(planned), "2026-11-16");
		assert.match(problemListText(chat.id, { scheduledOnly: true }), /117b.*not attempted yet/);
		const after = logAttempt({ source: "Zbirka", reference: "117b", outcome: "clean", chatId: chat.id }).entry;
		assert.equal(after.id, planned.id, "the attempt joins the planned entry");
		assert.equal(resolveDate(after), null, "a clean solve follows the rule");
		assert.match(problemEditFor(chat.id, { action: "plan", source: "Zbirka", reference: "118b" }), /date/);
	});
});

describe("teacher: cards", () => {
	it("adds explain cards to this course's deck, all-or-nothing", () => {
		assert.match(planStepsText(chat.id), /inv: Inverzne funkcije/, "steps in Latin");
		assert.match(makeCardsFor(chat.id, [{ nodeId: "nope", front: "Q", back: "A" }]), /No cards added.*unknown nodeId/);
		assert.equal(chatStore.getChat(chat.id)?.cards?.generated?.length ?? 0, 0);
		const out = makeCardsFor(chat.id, [
			{ nodeId: "inv", front: "Kako proveriš da funkcija ima inverznu?", back: "Injektivnost: $f(x_1)=f(x_2)\\Rightarrow x_1=x_2$, plus skup vrednosti." },
			{ nodeId: "inv", front: "Zašto periodična funkcija nema inverznu?", back: "$f(x)=f(x+T)$ za $x\\ne x+T$ — nije injektivna." },
		]);
		assert.match(out, /Added 2 cards/);
		const generated = chatStore.getChat(chat.id)?.cards?.generated ?? [];
		assert.equal(generated.length, 2);
		assert.equal(generated[0]!.tool, "explain");
		assert.equal(generated[0]!.args.question, "Kako proveriš da funkcija ima inverznu?");
		assert.match(String(generated[0]!.args.correctAnswer), /Injektivnost/);
	});

	it("a course without a plan can't take cards", () => {
		assert.match(makeCardsFor(other.id, [{ nodeId: "x", front: "Q", back: "A" }]), /no plan steps/);
	});
});
