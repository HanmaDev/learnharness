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

describe("problem log — review fixes", () => {
	it("keys keep every script; Cyrillic reads as Latin", async () => {
		const { problemKey } = await import("../src/core/problems.ts");
		assert.notEqual(problemKey("Збирка задатака", "Задатак 12"), problemKey("Вене Богославов", "12"));
		assert.equal(problemKey("Збирка", "Задатак 12"), problemKey("Zbirka", "zadatak 12"));
		assert.notEqual(problemKey("Łódź", "1"), problemKey("Odz", "1"));
	});

	it("a stored log this build can't fully read is reported, not rewritten", async () => {
		const { problemLogProblem } = await import("../src/core/problems.ts");
		assert.equal(problemLogProblem({ version: 1, entries: [] }), null);
		assert.match(problemLogProblem([]) ?? "", /object/);
		assert.match(problemLogProblem({ version: 2, entries: [] }) ?? "", /version/);
		assert.match(problemLogProblem({ version: 1, entries: {} }) ?? "", /list/);
		assert.match(problemLogProblem({ version: 1, entries: [{ id: "x" }] }) ?? "", /malformed/);
		assert.match(problemLogProblem({ version: 1, entries: [{ id: "x", source: "s", reference: "r", attempts: [{ at: 1 }] }] }) ?? "", /attempts/);
	});

	it("store: same problem by trackerId first, never merging two archive problems; unreadable files move aside", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const { PATHS } = await import("../config.ts");
		const { logAttempt, problemLog } = await import("../src/server/problems.ts");
		const file = path.join(PATHS.data, "problems.json");
		const saved = fs.existsSync(file) ? fs.readFileSync(file) : null;
		try {
			if (saved) fs.unlinkSync(file);
			const a = logAttempt({ source: "DMS arhiva", reference: "zadatak 3", trackerId: "T1", outcome: "read" });
			const b = logAttempt({ source: "DMS arhiva", reference: "zadatak 3", trackerId: "T2", outcome: "hint" });
			assert.equal(b.created, true, "a different archive problem with the same text is a new entry");
			const c = logAttempt({ source: "Drugo ime", reference: "drugačije", trackerId: "T1", outcome: "clean" });
			assert.equal(c.entry.id, a.entry.id, "the archive id wins over the text");
			const d = logAttempt({ source: "EGMO", reference: "4.12", outcome: "hint" });
			const e = logAttempt({ source: "egmo", reference: "4 12", trackerId: "T9", outcome: "clean" });
			assert.equal(e.entry.id, d.entry.id);
			assert.equal(e.entry.trackerId, "T9", "the archive id is filled in");
			assert.equal(problemLog().entries.length, 3);
			fs.writeFileSync(file, JSON.stringify({ version: 7, entries: [] }));
			assert.equal(problemLog().entries.length, 0);
			assert.equal(fs.existsSync(file), false, "moved aside");
			assert.equal(fs.readdirSync(PATHS.data).some((f) => f.startsWith("problems.unreadable-")), true);
		} finally {
			for (const f of fs.readdirSync(PATHS.data)) if (f.startsWith("problems.unreadable-")) fs.unlinkSync(path.join(PATHS.data, f));
			if (saved) fs.writeFileSync(file, saved);
			else if (fs.existsSync(file)) fs.unlinkSync(file);
		}
	});

	it("archive lookup parses round, year, grade, category, day and number — and never guesses a tie", async () => {
		const { fieldsMatch, parseArchiveQuery, titleFields } = await import("../src/server/tracker-match.ts");
		const stages = ["Okružno", "Državno", "Državno A", "IMO", "SMO"];
		const titles = [
			["Okružno 2019/2020 · 3. razred · kategorija A · zadatak 4", "Okružno"],
			["Okružno 2019/2020 · 4. razred · kategorija A · zadatak 3", "Okružno"],
			["Okružno 2019/2020 · 4. razred · kategorija B · zadatak 3", "Okružno"],
			["Državno A 2025/2026 · 4. razred · kategorija A · zadatak 3", "Državno A"],
			["IMO 2006/2007 · 1. dan · zadatak 2", "IMO"],
			["IMO 2006/2007 · 2. dan · zadatak 2", "IMO"],
		] as const;
		const find = (q: string) => titles.filter(([t, s]) => fieldsMatch(parseArchiveQuery(q, stages), titleFields(t, s))).map(([t]) => t);
		assert.deepEqual(find("Okružno 2019/2020 4. razred A zadatak 3"), [titles[1][0]]);
		assert.deepEqual(find("okruzno 2019/20 4A z3"), [titles[1][0]]);
		assert.deepEqual(find("Okružno 2019/2020 · 4. razred · kategorija B · zadatak 3"), [titles[2][0]]);
		assert.equal(find("Okružno 2019/2020 zadatak 3").length, 2, "ambiguous → both, so the tool asks");
		assert.deepEqual(find("Državno A 2025/2026 4. razred kategorija A zadatak 3"), [titles[3][0]]);
		assert.deepEqual(find("IMO 2007 2. dan zadatak 2"), [titles[5][0]]);
		assert.equal(parseArchiveQuery("Okružno 2019/2020 4. razred A", stages).number, undefined);
	});
});
