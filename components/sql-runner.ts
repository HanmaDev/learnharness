"use client";

import type { SqlCell } from "@/src/core";

/**
 * Fork (2026-11-07): SQLite in the app, offline — sql.js (WebAssembly)
 * served from /vendor (copied from node_modules/sql.js/dist, MIT). Loaded
 * once as a plain script so the bundler never touches its Node branch.
 * Every run builds a FRESH in-memory database from the exercise's setup,
 * so a learner's DELETE/UPDATE can never poison the next run.
 */

interface SqlJsDatabase {
	exec(sql: string): Array<{ columns: string[]; values: SqlCell[][] }>;
	close(): void;
}
interface SqlJsStatic {
	Database: new () => SqlJsDatabase;
}

let engine: Promise<SqlJsStatic> | null = null;

export function loadSqlEngine(): Promise<SqlJsStatic> {
	if (engine) return engine;
	engine = new Promise<SqlJsStatic>((resolve, reject) => {
		const w = window as unknown as { initSqlJs?: (cfg: { locateFile: (f: string) => string }) => Promise<SqlJsStatic> };
		const start = () => w.initSqlJs!({ locateFile: () => "/vendor/sql-wasm.wasm" }).then(resolve, reject);
		if (w.initSqlJs) return void start();
		const script = document.createElement("script");
		script.src = "/vendor/sql-wasm.js";
		script.async = true;
		script.onload = () => (w.initSqlJs ? start() : reject(new Error("SQL engine failed to load")));
		script.onerror = () => reject(new Error("SQL engine failed to load"));
		document.head.appendChild(script);
	}).catch((err) => {
		engine = null; // let a later run retry
		throw err;
	});
	return engine;
}

export type SqlRun = { ok: true; columns: string[]; rows: SqlCell[][]; truncated: boolean } | { ok: false; error: string };

/** Run `query` against a fresh database built from `setup`. The LAST result
 *  set is the answer (a query may be preceded by helper statements). */
export async function runSql(setup: string, query: string, maxRows = 500): Promise<SqlRun> {
	const SQL = await loadSqlEngine();
	const db = new SQL.Database();
	try {
		try {
			db.exec(setup);
		} catch (err) {
			return { ok: false, error: `The exercise's database failed to build: ${(err as Error).message}` };
		}
		const results = db.exec(query);
		const last = results.at(-1);
		if (!last) return { ok: true, columns: [], rows: [], truncated: false };
		return { ok: true, columns: last.columns, rows: last.values.slice(0, maxRows), truncated: last.values.length > maxRows };
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	} finally {
		db.close();
	}
}

/** The tables and their columns, for the schema panel. */
export async function describeSchema(setup: string): Promise<Array<{ table: string; columns: string[]; rows: number }>> {
	const SQL = await loadSqlEngine();
	const db = new SQL.Database();
	try {
		db.exec(setup);
		const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values.map((v) => String(v[0])) ?? [];
		return tables.map((table) => {
			const cols = db.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)[0]?.values.map((v) => String(v[1])) ?? [];
			const count = Number(db.exec(`SELECT COUNT(*) FROM "${table.replace(/"/g, '""')}"`)[0]?.values[0]?.[0] ?? 0);
			return { table, columns: cols, rows: count };
		});
	} catch {
		return [];
	} finally {
		db.close();
	}
}
