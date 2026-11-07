/**
 * Fork (2026-11-07): plan progress (done marks, target date, study time,
 * pace) and "Talk to the teacher" (the interrupt input).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	computePlanProgress, daysUntil, deriveDoneNodes, formatStudyTime, isPlanDate, localDate,
	planProgressText, studyTimeMs, STUDY_GAP_MS,
} from "../src/core/plan-progress.ts";
import { createTree } from "../src/core/plan-tree.ts";
import { compactAnswerForModel, SET_ASIDE_NOTE } from "../src/core/question-core.ts";
import { inputAppends, parseChatInput, ChatInputError } from "../src/core/input-events.ts";
import { newUserMessage, toLlmMessages, type LhMessage } from "../src/core/native-messages.ts";
import { planTools } from "../src/agent/tools/plan.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { TalkToTeacher } from "../components/talk-to-teacher.tsx";
import { PlanProgressPanel, chipSummary } from "../components/plan-progress.tsx";
import { PlanDiagram } from "../components/plan-block.tsx";

const tree = createTree(
	[{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }, { id: "c", title: "Gamma" }, { id: "d", title: "Delta" }],
	[{ from: "a", to: "b" }, { from: "b", to: "c" }],
);
const T0 = new Date(2026, 10, 7, 10, 0, 0).getTime(); // 7 Nov 2026, 10:00 local
const MIN = 60_000;

let seq = 0;
function call(name: string, args: unknown, at: number, ok = true): LhMessage[] {
	const id = `call_${++seq}`;
	return [
		{ id: `m_${id}`, role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: at, stopReason: "toolUse" } as unknown as LhMessage,
		{ id: `r_${id}`, role: "toolResult", toolCallId: id, toolName: name, content: [], isError: !ok, timestamp: at + 1000 } as unknown as LhMessage,
	];
}
const user = (at: number): LhMessage => ({ ...newUserMessage("hi"), timestamp: at }) as LhMessage;

describe("plan progress — pure core", () => {
	it("done marks fold plan_progress calls in order; reopen removes; rejected calls and unknown ids move nothing", () => {
		const messages = [
			...call("plan_progress", { done: ["a", "b"] }, T0),
			...call("plan_progress", { done: ["c"] }, T0 + MIN, false), // rejected
			...call("plan_progress", { done: ["zzz"], reopen: ["b"] }, T0 + 2 * MIN),
		];
		assert.deepEqual([...deriveDoneNodes(tree, messages)], ["a"]);
	});

	it("study time sums gaps up to 15 minutes; longer gaps are breaks", () => {
		const times = [T0, T0 + 5 * MIN, T0 + 10 * MIN, T0 + 10 * MIN + STUDY_GAP_MS + 1, T0 + 10 * MIN + STUDY_GAP_MS + 1 + 2 * MIN];
		assert.equal(studyTimeMs(times.map(user), T0), 12 * MIN);
		assert.equal(studyTimeMs(times.map(user), T0 + 6 * MIN), 2 * MIN, "only after the start");
	});

	it("dates: validation, local days until, short study time", () => {
		assert.equal(isPlanDate("2026-11-15"), true);
		assert.equal(isPlanDate("2026-02-30"), false);
		assert.equal(isPlanDate("15.11.2026"), false);
		assert.equal(daysUntil("2026-11-15", T0), 8);
		assert.equal(daysUntil("2026-11-07", T0 + 13 * 60 * MIN), 0, "same local day late at night");
		assert.equal(localDate(T0), "2026-11-07");
		assert.equal(formatStudyTime(130 * MIN), "2 h 10 min");
		assert.equal(formatStudyTime(45 * MIN), "45 min");
		assert.equal(formatStudyTime(10_000), "< 1 min");
	});

	it("progress, time left and pace toward the target", () => {
		// Plan starts at T0; 60 min of study; 3 of 4 nodes taught (tagged questions) and done.
		const messages = [
			...call("plan_init", { mermaid: "x" }, T0),
			...call("quiz", { nodeId: "a" }, T0 + MIN),
			...call("quiz", { nodeId: "b" }, T0 + 2 * MIN),
			...call("exercise", { nodeId: "c" }, T0 + 3 * MIN),
			...Array.from({ length: 12 }, (_, i) => user(T0 + (i + 1) * 5 * MIN)),
			...call("plan_progress", { done: ["a", "b", "c"] }, T0 + 60 * MIN),
		];
		const now = T0 + 61 * MIN;
		const p = computePlanProgress({ tree, messages, target: { date: "2026-11-08", setBy: "learner", at: "x" }, now });
		assert.equal(p.done, 3);
		assert.equal(p.measuredDone, 3);
		assert.equal(p.total, 4);
		assert.equal(p.percent, 75);
		assert.ok(Math.abs(p.studyMs - 61 * MIN) < 2 * MIN, `study ≈ 61 min (got ${p.studyMs / MIN})`);
		assert.ok(p.remainingMs !== null && Math.abs(p.remainingMs - p.studyMs / 3) < 1, "1 node left at the measured per-node rate");
		assert.equal(p.daysLeft, 2, "today + tomorrow");
		assert.equal(p.nodesPerDay, 0.5);
		assert.equal(p.pace, "on-track", "61 min/day so far vs ~10 min/day needed");
		const tight = computePlanProgress({ tree, messages, target: { date: "2026-11-07", setBy: "teacher", at: "x" }, now });
		assert.equal(tight.daysLeft, 1);
		assert.equal(tight.pace, "on-track", "exactly enough today");
		const past = computePlanProgress({ tree, messages, target: { date: "2026-11-06", setBy: "teacher", at: "x" }, now });
		assert.equal(past.pace, "past");
		const text = planProgressText(p);
		assert.match(text, /Done 3\/4 nodes \(75%\)/);
		assert.match(text, /Target date: 2026-11-08 \(set by the learner\)/);
		assert.match(text, /On track/);
	});

	it("no estimate before 3 measured steps; catch-up marks never count; complete when all are done", () => {
		const none = computePlanProgress({ tree, messages: [...call("plan_init", {}, T0), user(T0 + 5 * MIN)], now: T0 + 6 * MIN });
		assert.equal(none.remainingMs, null);
		assert.equal(none.pace, null);
		assert.match(planProgressText(none), /needs 3 steps finished with questions in this chat \(0 so far\)/);
		// The fork's real bug: 3 steps marked done from a catch-up note (no questions) after 5 min.
		const catchUp = computePlanProgress({
			tree,
			messages: [...call("plan_init", {}, T0), user(T0 + 2 * MIN), ...call("plan_progress", { done: ["a", "b", "c"] }, T0 + 5 * MIN)],
			now: T0 + 6 * MIN,
		});
		assert.equal(catchUp.done, 3, "they still count as done");
		assert.equal(catchUp.measuredDone, 0, "but not as measured pace");
		assert.equal(catchUp.remainingMs, null, "no absurd '4 minutes per step' estimate");
		const all = computePlanProgress({ tree, messages: [...call("plan_init", {}, T0), ...call("plan_progress", { done: ["a", "b", "c", "d"] }, T0 + 5 * MIN)], now: T0 + 6 * MIN });
		assert.equal(all.percent, 100);
		assert.equal(all.pace, "complete");
	});
});

// ─── tools against the real store ────────────────────────────────────────────

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) fs.rmSync(path.join(PATHS.chats, `${id}.json`), { force: true });
});
function newChat(): string {
	const chat = chatStore.createChat("Plan progress");
	createdChats.push(chat.id);
	return chat.id;
}
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? "").join("");

describe("plan tools — targetDate and plan_progress", () => {
	it("plan_init saves a valid targetDate (setBy teacher) and rejects an impossible one", async () => {
		const chatId = newChat();
		const tools = planTools({ chatId, chatStore });
		const bad = await tools.plan_init!.execute("t1", { mermaid: "graph TD\n  a[A] --> b[B]", targetDate: "2026-13-01" });
		assert.match(text(bad as never), /targetDate must be a real calendar date/);
		const ok = await tools.plan_init!.execute("t2", { mermaid: "graph TD\n  a[A] --> b[B]", targetDate: "2026-11-15" });
		assert.match(text(ok as never), /"targetDate":"2026-11-15"/);
		const target = chatStore.getChat(chatId)!.planTarget!;
		assert.equal(target.date, "2026-11-15");
		assert.equal(target.setBy, "teacher");
		// A rewrite without targetDate keeps it.
		await tools.plan_init!.execute("t3", { mermaid: "graph TD\n  a[A] --> b[B] --> c[C]" });
		assert.equal(chatStore.getChat(chatId)!.planTarget!.date, "2026-11-15");
	});

	it("plan_progress validates ids against the live map and reports the numbers including this call", async () => {
		const chatId = newChat();
		const tools = planTools({ chatId, chatStore });
		const none = await tools.plan_progress!.execute("p0", { done: ["a"] });
		assert.match(text(none as never), /no plan yet/);
		await tools.plan_init!.execute("t1", { mermaid: "graph TD\n  a[A] --> b[B]" });
		const unknown = await tools.plan_progress!.execute("p1", { done: ["nope"] });
		assert.match(text(unknown as never), /Unknown node id\(s\): nope/);
		const res = await tools.plan_progress!.execute("p2", { done: ["a"] });
		assert.match(text(res as never), /Done 1\/2 nodes \(50%\)/);
		assert.match(text(res as never), /No target date set/);
	});

	it("plan_progress counts earlier calls from the SAME turn (live agent messages)", async () => {
		const chatId = newChat();
		let live: LhMessage[] = [];
		const tools = planTools({ chatId, chatStore, liveMessages: () => live });
		await tools.plan_init!.execute("t1", { mermaid: "graph TD\n  a[A] --> b[B] --> c[C]" });
		// The record has no turn messages yet; the live agent does.
		live = [...chatStore.getChat(chatId)!.messages, ...call("plan_init", {}, T0), ...call("plan_progress", { done: ["a"] }, T0 + MIN)];
		const res = await tools.plan_progress!.execute("p3", { done: ["b"] });
		assert.match(text(res as never), /Done 2\/3 nodes \(67%\)/);
	});
});

// ─── the target-date notice and the interrupt input ─────────────────────────

const quizCall = (id: string, question: string): LhMessage =>
	({
		id: `a_${id}`, role: "assistant", stopReason: "toolUse", timestamp: T0,
		content: [{ type: "toolCall", id, name: "quiz", arguments: { type: "check", nodeId: "a", question, options: [{ label: "x", value: "x" }, { label: "y", value: "y" }], explanation: "e", correctAnswer: "x" } }],
	}) as unknown as LhMessage;

describe("learner target-date notice", () => {
	it("a learner-set date rides the next input once; a teacher-set date never does", () => {
		const target = { date: "2026-11-20", setBy: "learner", at: "2026-11-07T10:00:00.000Z" };
		const first = inputAppends({ messages: [], planTarget: target }, { type: "text", text: "next" });
		assert.equal(first.length, 2);
		assert.equal(first[0]!.role, "custom");
		assert.match((first[0] as { content: string }).content, /target date to 2026-11-20/);
		const again = inputAppends({ messages: first, planTarget: target }, { type: "text", text: "more" });
		assert.equal(again.length, 1, "announced once");
		const teacher = inputAppends({ messages: [], planTarget: { ...target, setBy: "teacher" } }, { type: "text", text: "x" });
		assert.equal(teacher.length, 1);
		const cleared = inputAppends({ messages: [] }, { type: "text", text: "x" }, "2026-11-07T11:00:00.000Z");
		assert.match((cleared[0] as { content: string }).content, /removed this plan's target date/);
	});

	it("never rides an answer (a sibling may still wait; the record must end in the result)", () => {
		const target = { date: "2026-11-20", setBy: "learner", at: "t1" };
		const both = {
			...quizCall("q1", "First?"),
			content: [...(quizCall("q1", "First?") as { content: unknown[] }).content, ...(quizCall("q2", "Second?") as { content: unknown[] }).content],
		} as unknown as LhMessage;
		const answer = { kind: "quiz" as const, questionText: "First?", dontKnow: false, answers: [{ index: 0, label: "x" }], answeredAt: "t" };
		const appends = inputAppends({ messages: [both], planTarget: target }, { type: "answer", toolCallId: "q1", answer: answer as never });
		assert.deepEqual(appends.map((m) => m.role), ["toolResult"]);
		// It still rides the interrupt, after every set-aside result.
		const after = inputAppends({ messages: [both, ...appends], planTarget: target }, { type: "interrupt", text: "wait" });
		assert.deepEqual(after.map((m) => m.role), ["toolResult", "custom", "user"]);
	});

	it("the notice reaches the model as text and stays out of the view", () => {
		const appends = inputAppends({ messages: [], planTarget: { date: "2026-11-20", setBy: "learner", at: "z" } }, { type: "text", text: "hi" });
		const wire = toLlmMessages(appends as never) as Array<{ role: string; content: Array<{ text?: string }> | string }>;
		assert.ok(wire.some((m) => JSON.stringify(m.content).includes("2026-11-20")));
	});
});

describe("Talk to the teacher — the interrupt input", () => {
	it("parses non-empty text only", () => {
		assert.deepEqual(parseChatInput({ type: "interrupt", text: "stop" }), { type: "interrupt", text: "stop" });
		assert.throws(() => parseChatInput({ type: "interrupt", text: "  " }), ChatInputError);
	});

	it("sets EVERY waiting question aside, then appends the message; refuses with nothing waiting", () => {
		const both: LhMessage = {
			...quizCall("q1", "First?"),
			content: [...(quizCall("q1", "First?") as { content: unknown[] }).content, ...(quizCall("q2", "Second?") as { content: unknown[] }).content],
		} as unknown as LhMessage;
		const appends = inputAppends({ messages: [both] }, { type: "interrupt", text: "wait, what is a tbody?" });
		assert.deepEqual(appends.map((m) => m.role), ["toolResult", "toolResult", "user"]);
		const results = appends.slice(0, 2) as unknown as Array<{ toolCallId: string; content: Array<{ text: string }>; details: { setAside?: boolean; questionText: string } }>;
		assert.deepEqual(results.map((r) => r.toolCallId), ["q1", "q2"]);
		assert.equal(results[0]!.details.setAside, true);
		assert.equal(results[0]!.details.questionText, "First?");
		assert.deepEqual(JSON.parse(results[0]!.content[0]!.text), { kind: "quiz", setAside: true, note: SET_ASIDE_NOTE });
		assert.throws(() => inputAppends({ messages: [] }, { type: "interrupt", text: "x" }), ChatInputError);
	});

	it("a plain dismissal still reads as dismissed", () => {
		assert.deepEqual(compactAnswerForModel({ kind: "quiz", questionText: "q", dontKnow: false, answers: [], dismissed: true, answeredAt: "t" }), { kind: "quiz", dismissed: true });
	});
});

// ─── rendering ───────────────────────────────────────────────────────────────

const quizInput = { type: "check", nodeId: "a", question: "Which tag?", options: [{ label: "th", value: "th" }, { label: "td", value: "td" }], explanation: "e", correctAnswer: "th" };

describe("rendering", () => {
	it("the dock offers Talk to the teacher only when the page wires it", () => {
		const withTalk = renderToStaticMarkup(<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput as never} expanded onExpand={() => {}} onSubmit={() => {}} onTalk={() => {}} />);
		assert.match(withTalk, /data-testid="talk-to-teacher-open"/);
		assert.match(withTalk, /Alt\+T/);
		const without = renderToStaticMarkup(<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput as never} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.ok(!without.includes("talk-to-teacher"));
	});

	it("the open talk field is its own keyboard surface with Send", () => {
		const html = renderToStaticMarkup(<TalkToTeacher active open onOpenChange={() => {}} onTalk={() => {}} />);
		assert.match(html, /data-talk-to-teacher=""/);
		assert.match(html, /data-testid="talk-to-teacher-send"/);
		assert.match(html, /The question waits/);
	});

	it("a set-aside question reads differently from a skipped one", () => {
		const base = { kind: "quiz" as const, questionText: "Which tag?", dontKnow: false, answers: [], dismissed: true, answeredAt: "t" };
		assert.match(renderToStaticMarkup(<AnsweredCard answer={{ ...base, setAside: true }} />), /set aside: you talked to the teacher/);
		assert.match(renderToStaticMarkup(<AnsweredCard answer={base} />), /— skipped/);
	});

	it("the progress panel and chip show counts, time, the date control and pace", () => {
		const messages = [
			...call("plan_init", {}, T0),
			...Array.from({ length: 6 }, (_, i) => user(T0 + (i + 1) * 5 * MIN)),
			...call("plan_progress", { done: ["a"] }, T0 + 30 * MIN),
		];
		const p = computePlanProgress({ tree, messages, target: { date: "2026-11-15", setBy: "teacher", at: "x" }, now: T0 + 31 * MIN });
		const html = renderToStaticMarkup(<PlanProgressPanel progress={p} inProgress={1} onSetTarget={async () => true} />);
		assert.match(html, /25%/);
		assert.match(html, /1 done · 1 in progress · 2 ahead/);
		assert.match(html, /data-testid="plan-target-date"[^>]*value="2026-11-15"/);
		assert.match(html, /set by the teacher/);
		assert.ok(!html.includes('data-testid="plan-pace"'), "no pace verdict without an estimate");
		assert.match(chipSummary(p), /^1\/4 · 15 Nov$/, "no time until 3 measured steps");
		assert.match(html, /after 3 measured steps \(0 so far\)/);
	});

	it("done nodes get the green check on the map", () => {
		const html = renderToStaticMarkup(
			<PlanDiagram nodes={tree.nodes} edges={tree.edges} statusOf={() => "visited"} doneOf={(id) => id === "a"} markerId="m" />,
		);
		assert.match(html, /data-testid="plan-node-done-a"/);
		assert.ok(!html.includes("plan-node-done-b"));
	});
});
