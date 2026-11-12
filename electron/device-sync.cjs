/**
 * Fork (2026-11-12, owner: "set up syncing across devices"): LearnHarness on
 * several computers through OneDrive.
 *
 *   <userData>/device.json  — THIS computer only (never synced):
 *     { dataDir?, pathAliases?: [{from,to}], declinedSync? }
 *   <OneDrive>/LearnHarness/
 *     data/        — the app data both computers use
 *     sync.json    — { version: 1, courseRoots: [{ from, folder }] }: the course
 *                    root lessons were written against and its OneDrive folder
 *     tracker/     — read-only copy of the Matematika Tracker archive
 *     Instalacija/ — installers
 *
 * A lock file NEXT TO the synced data (<OneDrive>/LearnHarness, so backups and
 * conflict checks never see it) warns when the app is already open on another
 * computer; OneDrive conflict copies are reported at start. A configured
 * synced folder that is missing is never silently swapped for local data.
 * Credentials (auth.json) never leave the computer.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG_FILE = "device.json";
const LOCK_FILE = ".lh-device-lock.json";
const LOCK_HEARTBEAT_MS = 2 * 60_000;
const LOCK_STALE_MS = 6 * 60_000;

function readJson(file) {
	try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJsonAtomic(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	fs.renameSync(tmp, file);
}

function readDeviceConfig(userData) {
	const config = readJson(path.join(userData, CONFIG_FILE));
	return config && typeof config === "object" && !Array.isArray(config) ? config : {};
}

function writeDeviceConfig(userData, config) {
	writeJsonAtomic(path.join(userData, CONFIG_FILE), config);
}

function configuredDataDir(config) {
	return typeof config.dataDir === "string" && path.isAbsolute(config.dataDir) ? config.dataDir : null;
}

/** The data folder this computer uses: its configured synced folder (even
 *  when missing — startup asks, never silently falls back to stale local
 *  data), else the usual <userData>/data. */
function resolveDataDir(userData, config = readDeviceConfig(userData)) {
	return configuredDataDir(config) ?? path.join(userData, "data");
}

function isSynced(userData, config = readDeviceConfig(userData)) {
	return configuredDataDir(config) !== null;
}

/** A configured synced folder that is not there right now (OneDrive not
 *  started, moved, signed out). */
function syncedFolderMissing(userData, config = readDeviceConfig(userData)) {
	const dir = configuredDataDir(config);
	return dir !== null && !fs.existsSync(dir);
}

function validAliases(list) {
	return Array.isArray(list)
		? list.filter((a) => a && typeof a.from === "string" && typeof a.to === "string" && path.isAbsolute(a.from) && path.isAbsolute(a.to))
		: [];
}

function oneDriveRoot(env = process.env) {
	for (const key of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
		const value = env[key];
		if (value && fs.existsSync(value)) return value;
	}
	return null;
}

function syncRoot(oneDrive) {
	return path.join(oneDrive, "LearnHarness");
}

/** Path aliases from the synced manifest, for this computer's OneDrive. */
function aliasesFromManifest(manifest, oneDrive) {
	const roots = manifest && Array.isArray(manifest.courseRoots) ? manifest.courseRoots : [];
	return validAliases(roots
		.filter((r) => r && typeof r.from === "string" && typeof r.folder === "string" && !r.folder.includes(".."))
		.map((r) => ({ from: r.from, to: path.join(oneDrive, r.folder) })));
}

/** Synced data exists in OneDrive and this computer has not chosen yet. */
function syncOffer({ userData, env = process.env, config = readDeviceConfig(userData) }) {
	if (config.dataDir || config.declinedSync) return null;
	const oneDrive = oneDriveRoot(env);
	if (!oneDrive) return null;
	const root = syncRoot(oneDrive);
	const dataDir = path.join(root, "data");
	if (!fs.existsSync(path.join(dataDir, "settings.json")) && !fs.existsSync(path.join(dataDir, "chats"))) return null;
	return { dataDir, pathAliases: aliasesFromManifest(readJson(path.join(root, "sync.json")), oneDrive), root };
}

/** Tracker archive for this computer: the local one, else the synced copy. */
function trackerDirFor(env = process.env, dataDir) {
	const local = path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "rs.matematika.tracker");
	if (fs.existsSync(path.join(local, "matematika-tracker.sqlite3"))) return null;
	const synced = path.join(path.dirname(dataDir), "tracker");
	return fs.existsSync(path.join(synced, "matematika-tracker.sqlite3")) ? synced : null;
}

// ── open-elsewhere lock ─────────────────────────────────────────────────────

/** Beside the data folder, never inside it. */
function lockPath(dataDir) {
	return path.join(path.dirname(dataDir), LOCK_FILE);
}

function readLock(dataDir) {
	const lock = readJson(lockPath(dataDir));
	return lock && typeof lock.host === "string" && typeof lock.heartbeat === "string" ? lock : null;
}

/** Another computer's fresh lock (null = free to open). */
function otherHolder(lock, { host = os.hostname(), now = Date.now(), staleMs = LOCK_STALE_MS } = {}) {
	if (!lock || lock.host === host) return null;
	const at = Date.parse(lock.heartbeat);
	return Number.isFinite(at) && now - at < staleMs ? lock : null;
}

/** A plain in-place write (no temp file + rename: OneDrive may hold the file
 *  open, and a failed rename would strand temp files in the synced folder). */
function writeLock(dataDir, host = os.hostname(), pid = process.pid, now = new Date()) {
	fs.writeFileSync(lockPath(dataDir), JSON.stringify({ host, pid, heartbeat: now.toISOString() }), "utf8");
}

function releaseLock(dataDir, host = os.hostname(), pid = process.pid) {
	const lock = readLock(dataDir);
	if (lock && lock.host === host && lock.pid === pid) {
		try { fs.rmSync(lockPath(dataDir), { force: true }); } catch { /* best effort */ }
	}
}

function ago(ms) {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

// ── OneDrive conflict copies ────────────────────────────────────────────────

/** Files OneDrive created for conflicting edits: "name-COMPUTER.ext" (maybe
 *  "-2") next to an existing "name.ext". Relative to the data folder. */
function conflictCopies(dataDir) {
	const found = [];
	const walk = (dir, depth) => {
		let entries;
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		const names = new Set(entries.map((e) => e.name));
		for (const entry of entries) {
			if (entry.isDirectory()) { if (depth < 2) walk(path.join(dir, entry.name), depth + 1); continue; }
			const ext = path.extname(entry.name);
			const stem = entry.name.slice(0, entry.name.length - ext.length);
			// Every hyphen is a possible split: "chat_x-DESKTOP-ABC.json" → "chat_x.json".
			for (let i = stem.indexOf("-"); i > 0; i = stem.indexOf("-", i + 1)) {
				if (/^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/.test(stem.slice(i + 1)) && names.has(`${stem.slice(0, i)}${ext}`)) {
					found.push(path.relative(dataDir, path.join(dir, entry.name)));
					break;
				}
			}
		}
	};
	walk(dataDir, 0);
	return found;
}

module.exports = {
	CONFIG_FILE, LOCK_FILE, LOCK_HEARTBEAT_MS, LOCK_STALE_MS,
	readDeviceConfig, writeDeviceConfig, resolveDataDir, isSynced, syncedFolderMissing, lockPath, validAliases, oneDriveRoot, syncRoot,
	aliasesFromManifest, syncOffer, trackerDirFor, readLock, otherHolder, writeLock, releaseLock, ago, conflictCopies,
};
