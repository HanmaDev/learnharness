/**
 * The active-study-time log (fork, 2026-11-08): data/study-time.json,
 * read-modify-write with an atomic replace (like a chat file). Lives in the
 * data folder, so the app's automatic backups carry it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { addStudySeconds, emptyStudyLog, parseStudyLog, type StudyTimeLog } from "../core/study-time.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const FILE = () => path.join(PATHS.data, "study-time.json");

export function readStudyLog(): StudyTimeLog {
	try {
		return parseStudyLog(JSON.parse(fs.readFileSync(FILE(), "utf-8")));
	} catch {
		return emptyStudyLog();
	}
}

export function recordStudySeconds(date: string, seconds: number, chatId: string | null): void {
	const next = addStudySeconds(readStudyLog(), date, seconds, chatId);
	fs.mkdirSync(PATHS.data, { recursive: true });
	writeFileAtomicSync(FILE(), JSON.stringify(next, null, "\t"));
}
