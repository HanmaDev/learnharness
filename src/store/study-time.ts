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

/** The log. Missing file = empty; a file that can't be parsed is moved aside
 *  (kept, never overwritten); any other read error throws, so a heartbeat can
 *  never replace real history with an empty log. */
export function readStudyLog(): StudyTimeLog {
	let raw: string;
	try {
		raw = fs.readFileSync(FILE(), "utf-8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStudyLog();
		throw e;
	}
	try {
		return parseStudyLog(JSON.parse(raw));
	} catch {
		fs.renameSync(FILE(), FILE().replace(/\.json$/, `.corrupt-${Date.now()}.json`));
		return emptyStudyLog();
	}
}

/** For display: never throws. */
export function readStudyLogSafe(): StudyTimeLog {
	try {
		return readStudyLog();
	} catch {
		return emptyStudyLog();
	}
}

export function recordStudySeconds(date: string, seconds: number, chatId: string | null): void {
	const next = addStudySeconds(readStudyLog(), date, seconds, chatId);
	fs.mkdirSync(PATHS.data, { recursive: true });
	writeFileAtomicSync(FILE(), JSON.stringify(next, null, "\t"), { allowInPlaceFallback: true });
}
