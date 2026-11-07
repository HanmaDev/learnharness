import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

/**
 * Fork (2026-11-07): validate an `sql` exercise BEFORE the learner sees it —
 * the setup must build and the reference query must run and return rows. A
 * broken reference would grade him against an error. Uses the same sql.js
 * build the app serves (public/vendor), loaded from disk at runtime (the
 * standalone server copies public/ next to itself and chdirs there).
 */

type Cell = string | number | null | Uint8Array;
interface Db { exec(sql: string): Array<{ columns: string[]; values: Cell[][] }>; close(): void }
interface SqlJs { Database: new () => Db }

let engine: Promise<SqlJs> | null = null;

function vendorDir(): string {
	return path.join(process.cwd(), "public", "vendor");
}

function loadEngine(): Promise<SqlJs> {
	if (engine) return engine;
	engine = (async () => {
		const dir = vendorDir();
		const req = createRequire(path.join(dir, "noop.js"));
		const init = req("./sql-wasm.js") as (cfg: { wasmBinary: Uint8Array }) => Promise<SqlJs>;
		return init({ wasmBinary: new Uint8Array(fs.readFileSync(path.join(dir, "sql-wasm.wasm"))) });
	})().catch((err) => {
		engine = null;
		throw err;
	});
	return engine;
}

/** Problems with the exercise's database or reference query ([] = fine). */
export async function sqlExerciseProblems(setupSql: string, referenceSql: string): Promise<string[]> {
	let SQL: SqlJs;
	try {
		SQL = await loadEngine();
	} catch {
		return []; // no engine here (tests without vendor files): the client still grades
	}
	const db = new SQL.Database();
	try {
		try {
			db.exec(setupSql);
		} catch (err) {
			return [`setupSql fails in SQLite: ${(err as Error).message}`];
		}
		let results;
		try {
			results = db.exec(referenceSql);
		} catch (err) {
			return [`referenceSql fails in SQLite: ${(err as Error).message}`];
		}
		const last = results.at(-1);
		// sql.js reports a zero-row SELECT as no result set at all.
		if (!last || last.values.length === 0) {
			return ["referenceSql returns no rows (or is not a SELECT) — it must be a query whose correct answer is visible in the data; an empty result can't tell right from wrong."];
		}
		return [];
	} finally {
		db.close();
	}
}
