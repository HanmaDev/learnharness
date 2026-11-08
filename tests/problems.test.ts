/** Fork (2026-11-08): the problem log — schedule, categories, filters. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attemptsByDay, defaultCategory, emptyProblemLog, filterProblems, isDue, parseProblemLog, problemCounts, problemKey, resolveDate, type ProblemEntry } from "../src/core/problems.ts";
import { statsView } from "../src/core/stats.ts";
import { parseProblemAction } from "../src/server/problems.ts";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const entry = (outcome: ProblemEntry["attempts"][number]["outcome"], when = at(2026, 11, 1), extra: Partial<ProblemEntry> = {}): ProblemEntry => ({
	id: "p1", category: "takmicenja", source: "EGMO", reference: "4.12", attempts: [{ id: "a1", at: when, outcome }], createdAt: when, ...extra,
});

describe("problem log", () => {
	it("re-solve dates follow the latest outcome; a hand-set date wins until the next attempt", () => {
		assert.equal(resolveDate(entry("read")), "2026-11-04");
		assert.equal(resolveDate(entry("hint")), "2026-11-08");
		assert.equal(resolveDate(entry("slow")), "2026-11-22");
		assert.equal(resolveDate(entry("clean")), null);
		assert.equal(resolveDate(entry("clean", undefined, { resolveOn: "2026-12-01" })), "2026-12-01");
		assert.equal(resolveDate(entry("read", undefined, { resolveOn: null })), null, "unscheduled by hand");
		const two = entry("read");
		two.attempts.push({ id: "a2", at: at(2026, 11, 5), outcome: "clean" });
		assert.equal(resolveDate(two), null, "a clean re-solve retires it");
		assert.equal(isDue(entry("read"), new Date(2026, 10, 4, 8).getTime()), true);
		assert.equal(isDue(entry("read"), new Date(2026, 10, 3, 23).getTime()), false);
	});

	it("default categories: course default, then source rules, then škola", () => {
		const log = emptyProblemLog();
		assert.equal(defaultCategory(log, "Schaum's College Physics"), "fizika");
		assert.equal(defaultCategory(log, "DMS arhiva"), "takmicenja");
		assert.equal(defaultCategory(log, "Thomas' Calculus"), "skola");
		log.courseCategory.c1 = "takmicenja";
		assert.equal(defaultCategory(log, "Thomas' Calculus", "c1"), "takmicenja");
	});

	it("same problem by key; filters and counts; per-day attempts", () => {
		assert.equal(problemKey("EGMO", "4.12"), problemKey("egmo", " 4 12 "));
		assert.equal(problemKey("Zbirka", "Šta đak"), problemKey("zbirka", "sta djak"));
		const list = [entry("read"), entry("clean", undefined, { id: "p2", category: "skola", reference: "3.4/17", source: "Thomas" })];
		assert.equal(filterProblems(list, { category: "skola" }).length, 1);
		assert.equal(filterProblems(list, { q: "3.4" }).length, 1);
		assert.equal(filterProblems(list, { outcome: "read" })[0]!.id, "p1");
		assert.deepEqual(problemCounts(list, new Date(2026, 10, 10).getTime()), { total: 2, due: 1, alone: 1, helped: 1 });
		assert.deepEqual(attemptsByDay(list).get("2026-11-01"), { attempts: 2, alone: 1 });
	});

	it("parsing is defensive; actions validate", () => {
		const log = parseProblemLog({ entries: [{ id: "x", source: "s", reference: "r", attempts: [{ at: "x", outcome: "bad" }, { id: "a", at: "2026-11-01T00:00:00Z", outcome: "hint" }] }, { nope: 1 }] });
		assert.equal(log.entries.length, 1);
		assert.equal(log.entries[0]!.attempts.length, 1);
		assert.equal(log.categories.length, 3);
		assert.equal(typeof parseProblemAction({ op: "attempt", input: { source: "EGMO", reference: "1", outcome: "nope" } }), "string");
		assert.equal(typeof parseProblemAction({ op: "delete", id: "__proto__" }), "string");
		assert.deepEqual(parseProblemAction({ op: "schedule", id: "p1", on: "auto" }), { op: "schedule", id: "p1", on: "auto" });
	});

	it("the stats page counts attempts per day, and per course by the attempt's chat", () => {
		const e = entry("hint", at(2026, 11, 8, 10), { chatId: "c1" });
		e.attempts.push({ id: "a2", at: at(2026, 11, 8, 11), outcome: "clean", chatId: "c2" });
		const now = new Date(2026, 10, 8, 20).getTime();
		const all = statsView([], { version: 1, days: {} }, now, null, [e]);
		assert.equal(all.ranges.today.problems, 2);
		assert.equal(all.ranges.today.problemsAlone, 1);
		assert.equal(all.streaks.current, 1, "a day with only problem attempts is an active day");
		assert.equal(statsView([], { version: 1, days: {} }, now, "c2", [e]).ranges.today.problems, 1);
	});
});
