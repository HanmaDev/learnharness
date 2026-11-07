/**
 * Fork (2026-11-07): the sql and html exercise formats.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildExerciseAnswer, exerciseInputProblems, gradeExercise, sqlIsOrdered, sqlResultsMatch, type ExerciseToolInput } from "../src/core/exercise.ts";
import { compactAnswerForModel } from "../src/core/question-core.ts";
import { sqlExerciseProblems } from "../src/agent/tools/sql-validate.ts";
import { teachExerciseToolFor } from "../src/agent/tools.ts";
import { createTree } from "../src/core/plan-tree.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";

const setupSql = "CREATE TABLE users(name TEXT, age INT); INSERT INTO users VALUES ('Ana',31),('Ivo',25),('Mia',40);";
const sqlEx: ExerciseToolInput = {
	type: "check", nodeId: "sql", format: "sql", question: "Names of users older than 30.", explanation: "WHERE age > 30.",
	setupSql, referenceSql: "SELECT name FROM users WHERE age > 30",
};
const htmlEx: ExerciseToolInput = {
	type: "check", nodeId: "html", format: "html", question: "Add a header row.", explanation: "<th> cells.", starterCode: "<table><tr><td>Ana</td></tr></table>",
};

describe("sql — result comparison", () => {
	it("ignores row order unless the reference sorts; compares values, not column names", () => {
		const ref = { columns: ["name"], rows: [["Ana"], ["Mia"]] };
		assert.equal(sqlResultsMatch(ref, { columns: ["n"], rows: [["Mia"], ["Ana"]] }, false), true);
		assert.equal(sqlResultsMatch(ref, { columns: ["n"], rows: [["Mia"], ["Ana"]] }, true), false);
		assert.equal(sqlResultsMatch(ref, { columns: ["name", "age"], rows: [["Ana", 31], ["Mia", 40]] }, false), false, "extra column");
		assert.equal(sqlResultsMatch(ref, { columns: ["name"], rows: [["Ana"]] }, false), false, "missing row");
		assert.equal(sqlResultsMatch({ columns: ["x"], rows: [[1], [null]] }, { columns: ["x"], rows: [[1.0], [null]] }, false), true, "1 = 1.0, NULL = NULL");
		assert.equal(sqlResultsMatch({ columns: ["x"], rows: [[null]] }, { columns: ["x"], rows: [["NULL"]] }, false), false, "NULL is not the text NULL");
	});

	it("detects a top-level ORDER BY, ignoring strings and comments", () => {
		assert.equal(sqlIsOrdered("SELECT * FROM t ORDER BY a"), true);
		assert.equal(sqlIsOrdered("SELECT 'order by' FROM t -- order by x"), false);
	});
});

describe("sql/html — grading and the model's view", () => {
	it("validation requires the database and the reference", () => {
		assert.deepEqual(exerciseInputProblems(sqlEx), []);
		assert.match(exerciseInputProblems({ ...sqlEx, setupSql: "" }).join(), /setupSql/);
		assert.match(exerciseInputProblems({ ...sqlEx, referenceSql: " " }).join(), /referenceSql/);
		assert.deepEqual(exerciseInputProblems(htmlEx), []);
	});

	it("sql grades by the computed match; the teacher sees the query and rows", () => {
		const right = buildExerciseAnswer(sqlEx, { response: { format: "sql", query: "SELECT name FROM users WHERE age>30", matched: true, columns: ["name"], rows: [["Ana"], ["Mia"]], expectedRows: 2 } });
		assert.equal(right.correct, true);
		const model = compactAnswerForModel(right);
		assert.equal(model.query, "SELECT name FROM users WHERE age>30");
		assert.equal(model.rowCount, 2);
		const broken = buildExerciseAnswer(sqlEx, { response: { format: "sql", query: "SELEC", matched: false, columns: [], rows: [], error: "syntax error" } });
		assert.equal(broken.correct, false);
		assert.equal(compactAnswerForModel(broken).error, "syntax error");
		assert.equal(gradeExercise(sqlEx, { format: "sql", query: "x", matched: true, columns: [], rows: [], error: "e" }).correct, false, "an error never counts");
	});

	it("html is teacher-graded: no app verdict, the code goes to the teacher", () => {
		const a = buildExerciseAnswer(htmlEx, { response: { format: "html", code: "<table><tr><th>Ime</th></tr></table>" } });
		assert.equal(a.correct, undefined);
		const model = compactAnswerForModel(a);
		assert.equal(model.correct, undefined);
		assert.equal(model.graded, false);
		assert.match(String(model.code), /<th>Ime<\/th>/);
	});
});

const created: string[] = [];
after(() => { for (const id of created) fs.rmSync(path.join(PATHS.chats, `${id}.json`), { force: true }); });

describe("sql — the reference is checked before the learner sees it", () => {
	it("a broken setup, a failing reference, or an empty result is returned to the teacher", async () => {
		assert.deepEqual(await sqlExerciseProblems(setupSql, sqlEx.referenceSql!), []);
		assert.match((await sqlExerciseProblems("CREATE TABL x", "SELECT 1")).join(), /setupSql fails/);
		assert.match((await sqlExerciseProblems(setupSql, "SELECT nme FROM users")).join(), /no such column: nme/);
		assert.match((await sqlExerciseProblems(setupSql, "SELECT name FROM users WHERE age > 99")).join(), /no rows/);
	});

	it("the exercise tool rejects a broken reference", async () => {
		const chat = chatStore.createChat("sql exercise");
		created.push(chat.id);
		chatStore.saveTree(chat.id, createTree([{ id: "sql", title: "SQL" }], []));
		const tool = teachExerciseToolFor({ chatId: chat.id, chatStore });
		const bad = await tool.execute("s1", { ...sqlEx, referenceSql: "SELECT nme FROM users" });
		assert.match(JSON.stringify(bad.content), /no such column/);
		const ok = await tool.execute("s2", sqlEx);
		assert.equal(ok.terminate, true);
	});
});

describe("sql/html — rendering", () => {
	it("the dock renders the editor, Run, and the live preview", () => {
		const sqlHtml = renderToStaticMarkup(<QuestionDock toolName="exercise" toolCallId="s" input={sqlEx as never} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.match(sqlHtml, /data-testid="exercise-sql-editor"/);
		assert.match(sqlHtml, /data-testid="exercise-sql-run"/);
		assert.match(sqlHtml, /write the query/);
		const html = renderToStaticMarkup(<QuestionDock toolName="exercise" toolCallId="h" input={htmlEx as never} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.match(html, /data-testid="exercise-html-preview"/);
		assert.match(html, /sandbox="allow-scripts"/);
	});

	it("answered cards: sql shows the result and a correct query; html says submitted", () => {
		const wrong = buildExerciseAnswer(sqlEx, { response: { format: "sql", query: "SELECT name FROM users", matched: false, columns: ["name"], rows: [["Ana"], ["Ivo"], ["Mia"]], expectedRows: 2 } });
		const card = renderToStaticMarkup(<AnsweredCard answer={wrong} input={sqlEx} />);
		assert.match(card, /expected 2 rows/);
		assert.match(card, /A correct query/);
		const h = buildExerciseAnswer(htmlEx, { response: { format: "html", code: "<p>x</p>" } });
		const hc = renderToStaticMarkup(<AnsweredCard answer={h} input={htmlEx} />);
		assert.match(hc, />submitted</);
		assert.ok(!hc.includes(">incorrect<"));
	});
});
