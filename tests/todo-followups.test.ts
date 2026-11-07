/**
 * Fork (2026-11-07): the follow-ups — exact SQL tie handling, and pruning
 * learner photo uploads nobody used.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { after, describe, it } from "node:test";
import { sqlMatchesWithTies, sqlWithOrderKeys, type SqlCell } from "../src/core/exercise.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../config.ts";

const vendor = path.resolve(import.meta.dirname, "..", "public", "vendor");
type Db = { exec(sql: string): Array<{ columns: string[]; values: SqlCell[][] }>; close(): void };
async function sqlite(): Promise<{ Database: new () => Db }> {
	const init = createRequire(path.join(vendor, "noop.js"))("./sql-wasm.cjs") as (c: { wasmBinary: Uint8Array }) => Promise<{ Database: new () => Db }>;
	return init({ wasmBinary: new Uint8Array(fs.readFileSync(path.join(vendor, "sql-wasm.wasm"))) });
}

const setup = "CREATE TABLE e(name TEXT, dept TEXT, age INT); INSERT INTO e VALUES ('Ana','IT',31),('Ivo','HR',25),('Mia','IT',40),('Zoe','HR',29);";

describe("sqlWithOrderKeys — the reference also returns its sort keys", () => {
	it("appends key expressions before the top-level FROM, keeping the ORDER BY", () => {
		const k = sqlWithOrderKeys("SELECT name FROM e ORDER BY dept, age DESC;")!;
		assert.equal(k.sql, "SELECT name, (dept) AS __lh_k0, (age) AS __lh_k1 FROM e ORDER BY dept, age DESC");
		assert.deepEqual(k.keys, [{ appended: 0, nocase: false }, { appended: 1, nocase: false }]);
	});

	it("positional keys read the output column; subqueries and strings are skipped", () => {
		assert.deepEqual(sqlWithOrderKeys("SELECT name, age FROM e ORDER BY 2")!.keys, [{ position: 2, nocase: false }]);
		const nested = sqlWithOrderKeys("SELECT name FROM (SELECT * FROM e ORDER BY age) t WHERE name <> 'from' ORDER BY dept")!;
		assert.match(nested.sql, /^SELECT name, \(dept\) AS __lh_k0 FROM \(SELECT \* FROM e ORDER BY age\) t/);
	});

	it("declines shapes it can't rewrite safely", () => {
		assert.equal(sqlWithOrderKeys("SELECT DISTINCT dept FROM e ORDER BY dept"), null);
		assert.equal(sqlWithOrderKeys("SELECT name FROM e UNION SELECT dept FROM e ORDER BY 1"), null);
		assert.equal(sqlWithOrderKeys("SELECT name FROM e"), null);
	});
});

describe("tie-aware ordered comparison (real SQLite)", () => {
	it("ties may come in any order; everything else must follow the sort", async () => {
		const SQL = await sqlite();
		const db = new SQL.Database();
		db.exec(setup);
		const reference = "SELECT name FROM e ORDER BY dept";
		const keyed = sqlWithOrderKeys(reference)!;
		const run = db.exec(keyed.sql)[0]!;
		const keyedResult = { columns: run.columns, rows: run.values };
		const got = (rows: string[]) => ({ columns: ["name"], rows: rows.map((r) => [r]) });
		// HR (Ivo, Zoe) then IT (Ana, Mia); order inside a dept is free.
		assert.equal(sqlMatchesWithTies(keyedResult, keyed.keys, 1, got(["Zoe", "Ivo", "Mia", "Ana"])), true);
		assert.equal(sqlMatchesWithTies(keyedResult, keyed.keys, 1, got(["Ivo", "Zoe", "Ana", "Mia"])), true);
		assert.equal(sqlMatchesWithTies(keyedResult, keyed.keys, 1, got(["Ana", "Ivo", "Mia", "Zoe"])), false, "sorted by name, not dept");
		assert.equal(sqlMatchesWithTies(keyedResult, keyed.keys, 1, got(["Ivo", "Ana", "Zoe", "Mia"])), false, "groups interleaved");
		// A secondary key leaves no ties: the order is fully determined.
		const strict = sqlWithOrderKeys("SELECT name FROM e ORDER BY dept, age")!;
		const s = db.exec(strict.sql)[0]!;
		assert.equal(sqlMatchesWithTies({ columns: s.columns, rows: s.values }, strict.keys, 1, got(["Zoe", "Ivo", "Ana", "Mia"])), false);
		assert.equal(sqlMatchesWithTies({ columns: s.columns, rows: s.values }, strict.keys, 1, got(["Ivo", "Zoe", "Ana", "Mia"])), true);
		db.close();
	});
});

describe("review fixes: aliases and COLLATE NOCASE", () => {
	it("an ORDER BY alias reads its output column, even when it shadows a source column", async () => {
		const SQL = await sqlite();
		const db = new SQL.Database();
		db.exec("CREATE TABLE p(name TEXT, price INT, qty INT); INSERT INTO p VALUES ('a',5,1),('B',5,3),('c',2,1);");
		const k = sqlWithOrderKeys("SELECT name, price*qty AS price FROM p ORDER BY price")!;
		assert.deepEqual(k.keys, [{ position: 2, nocase: false }]);
		const run = db.exec(k.sql)[0]!;
		const keyed = { columns: run.columns, rows: run.values };
		const got = (rows: Array<[string, number]>) => ({ columns: ["name", "price"], rows });
		assert.equal(sqlMatchesWithTies(keyed, k.keys, 2, got([["c", 2], ["a", 5], ["B", 15]])), true);
		assert.equal(sqlMatchesWithTies(keyed, k.keys, 2, got([["c", 2], ["B", 15], ["a", 5]])), false, "5 and 15 are not a tie");
		const agg = sqlWithOrderKeys("SELECT dept, COUNT(*) AS n FROM e GROUP BY dept ORDER BY n DESC")!;
		assert.deepEqual(agg.keys, [{ position: 2, nocase: false }], "aggregate alias by position");
		db.close();
	});

	it("COLLATE NOCASE keys tie case-insensitively", () => {
		const k = sqlWithOrderKeys("SELECT name FROM t ORDER BY name COLLATE NOCASE")!;
		assert.deepEqual(k.keys, [{ appended: 0, nocase: true }]);
		const keyed = { columns: ["name", "__lh_k0"], rows: [["b", "b"], ["B", "B"], ["c", "c"]] as SqlCell[][] };
		assert.equal(sqlMatchesWithTies(keyed, k.keys, 1, { columns: ["name"], rows: [["B"], ["b"], ["c"]] }), true);
		assert.equal(sqlMatchesWithTies(keyed, k.keys, 1, { columns: ["name"], rows: [["c"], ["b"], ["B"]] }), false);
	});
});

const created: string[] = [];
after(() => { for (const id of created) fs.rmSync(path.join(PATHS.chats, `${id}.json`), { force: true }); });
// Snapshot ids are the sha256 of the stored bytes (the store verifies it).
const snap = (seed: string) => {
	const data = Buffer.from(`png-${seed}`).toString("base64");
	return { id: createHash("sha256").update(Buffer.from(data, "base64")).digest("hex"), image: { mimeType: "image/png" as const, data, width: 1, height: 1 } };
};
const [SA, SB, SC] = [snap("a"), snap("b"), snap("c")];
const A = SA.id, B = SB.id, C = SC.id;
const imgOf = (id: string) => [SA, SB, SC].find((x) => x.id === id)!.image;

describe("photo upload pruning", () => {
	it("a removed, unused upload is dropped; a submitted one never is", () => {
		const chat = chatStore.createChat("prune");
		created.push(chat.id);
		chatStore.savePhotoUpload(chat.id, A, imgOf(A));
		chatStore.savePhotoUpload(chat.id, B, imgOf(B));
		const rec = chatStore.getChat(chat.id)!;
		chatStore.saveMessages(chat.id, [...rec.messages, { id: "m1", role: "custom", customType: "practice-thinking", content: "x", display: true, details: { problemCallId: "p", text: "x", images: [{ snapshotId: B }] }, timestamp: 1 } as never]);
		assert.equal(chatStore.removeUnusedPhoto(chat.id, A), true);
		assert.equal(chatStore.removeUnusedPhoto(chat.id, B), false, "used by a submission");
		const after = chatStore.getChat(chat.id)!;
		assert.equal(after.imageSnapshots?.[A], undefined);
		assert.ok(after.imageSnapshots?.[B]);
	});

	it("uploads left unsent for over a day are pruned on the next upload; show_image snapshots never are", () => {
		const chat = chatStore.createChat("prune stale");
		created.push(chat.id);
		chatStore.saveImageSnapshot(chat.id, C, imgOf(C)); // a show_image snapshot: not an upload
		chatStore.savePhotoUpload(chat.id, A, imgOf(A));
		// Age the upload by rewriting its time in the record file.
		const file = path.join(PATHS.chats, `${chat.id}.json`);
		const raw = JSON.parse(fs.readFileSync(file, "utf8"));
		raw.photoUploads[A] = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
		fs.writeFileSync(file, JSON.stringify(raw));
		chatStore.savePhotoUpload(chat.id, B, imgOf(B));
		const rec = chatStore.getChat(chat.id)!;
		assert.equal(rec.imageSnapshots?.[A], undefined, "stale unsent upload pruned");
		assert.ok(rec.imageSnapshots?.[B], "fresh upload kept");
		assert.ok(rec.imageSnapshots?.[C], "show_image snapshot untouched");
	});
});
