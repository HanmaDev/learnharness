/**
 * Fork (2026-11-12): OneDrive sync — the device config, the synced-data
 * offer, path aliases for course files, the open-elsewhere lock, conflict
 * copies, and the server's folder/alias handling.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { after, describe, it } from "node:test";
import { aliasedPath } from "../src/agent/tools/fs-shared.ts";
import { parsePathAliases, withAliasedFolders } from "../src/server/device-paths.ts";

type Alias = { from: string; to: string };
const sync = createRequire(import.meta.url)("../electron/device-sync.cjs") as {
	readDeviceConfig(userData: string): Record<string, unknown>;
	writeDeviceConfig(userData: string, c: Record<string, unknown>): void;
	resolveDataDir(userData: string, c?: Record<string, unknown>): string;
	isSynced(userData: string, c?: Record<string, unknown>): boolean;
	syncedFolderMissing(userData: string, c?: Record<string, unknown>): boolean;
	lockPath(dataDir: string): string;
	syncOffer(o: { userData: string; env: Record<string, string | undefined>; config?: Record<string, unknown> }): { dataDir: string; pathAliases: Alias[]; root: string } | null;
	trackerDirFor(env: Record<string, string | undefined>, dataDir: string): string | null;
	readLock(dataDir: string): { host: string; pid: number; heartbeat: string } | null;
	otherHolder(lock: unknown, o?: { host?: string; now?: number; staleMs?: number }): { host: string } | null;
	writeLock(dataDir: string, host?: string, pid?: number, now?: Date): void;
	releaseLock(dataDir: string, host?: string, pid?: number): void;
	conflictCopies(dataDir: string): string[];
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-device-sync-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const dir = (...p: string[]) => { const d = path.join(tmp, ...p); fs.mkdirSync(d, { recursive: true }); return d; };

describe("device config and the synced-data offer", () => {
	it("uses <userData>/data until device.json names a synced folder; a missing one is flagged, never swapped for local data", () => {
		const userData = dir("a", "userData");
		assert.equal(sync.resolveDataDir(userData), path.join(userData, "data"));
		assert.equal(sync.isSynced(userData), false);
		const missing = path.join(tmp, "a", "missing");
		sync.writeDeviceConfig(userData, { dataDir: missing });
		assert.equal(sync.resolveDataDir(userData), missing, "no silent fallback to stale local data");
		assert.equal(sync.isSynced(userData), true);
		assert.equal(sync.syncedFolderMissing(userData), true, "startup asks instead");
		const synced = dir("a", "OneDrive", "LearnHarness", "data");
		sync.writeDeviceConfig(userData, { dataDir: synced });
		assert.equal(sync.resolveDataDir(userData), synced);
		assert.equal(sync.syncedFolderMissing(userData), false);
	});

	it("offers OneDrive data with the manifest's course mapping; never twice", () => {
		const userData = dir("b", "userData");
		const oneDrive = dir("b", "OneDrive");
		const env = { OneDrive: oneDrive };
		assert.equal(sync.syncOffer({ userData, env }), null, "no synced data yet");
		const root = dir("b", "OneDrive", "LearnHarness");
		fs.mkdirSync(path.join(root, "data", "chats"), { recursive: true });
		fs.writeFileSync(path.join(root, "sync.json"), JSON.stringify({ version: 1, courseRoots: [{ from: "C:\\Users\\computer\\Documents\\Ucenje", folder: "Ucenje" }, { from: "rel", folder: "x" }, { from: "C:\\x", folder: "..\\evil" }] }));
		const offer = sync.syncOffer({ userData, env })!;
		assert.equal(offer.dataDir, path.join(root, "data"));
		assert.deepEqual(offer.pathAliases, [{ from: "C:\\Users\\computer\\Documents\\Ucenje", to: path.join(oneDrive, "Ucenje") }]);
		assert.equal(sync.syncOffer({ userData, env, config: { declinedSync: true } }), null);
		assert.equal(sync.syncOffer({ userData, env, config: { dataDir: offer.dataDir } }), null);
		assert.equal(sync.syncOffer({ userData, env: {} }), null, "no OneDrive on this computer");
	});

	it("points at the synced Tracker copy only when there is no local Tracker", () => {
		const appData = dir("c", "AppData");
		const dataDir = dir("c", "OneDrive", "LearnHarness", "data");
		const synced = dir("c", "OneDrive", "LearnHarness", "tracker");
		assert.equal(sync.trackerDirFor({ APPDATA: appData }, dataDir), null);
		fs.writeFileSync(path.join(synced, "matematika-tracker.sqlite3"), "");
		assert.equal(sync.trackerDirFor({ APPDATA: appData }, dataDir), synced);
		fs.mkdirSync(path.join(appData, "rs.matematika.tracker"), { recursive: true });
		fs.writeFileSync(path.join(appData, "rs.matematika.tracker", "matematika-tracker.sqlite3"), "");
		assert.equal(sync.trackerDirFor({ APPDATA: appData }, dataDir), null, "the local Tracker wins");
	});
});

describe("open-elsewhere lock", () => {
	it("warns only for another computer's fresh heartbeat, and releases only its own lock", () => {
		const dataDir = dir("lock", "data");
		const now = Date.parse("2026-11-12T10:00:00Z");
		sync.writeLock(dataDir, "LAPTOP", 42, new Date(now - 60_000));
		const lock = sync.readLock(dataDir);
		assert.equal(sync.lockPath(dataDir), path.join(path.dirname(dataDir), ".lh-device-lock.json"), "beside the data, never inside it (backups, conflict checks)");
		assert.deepEqual(fs.readdirSync(dataDir), []);
		assert.equal(sync.otherHolder(lock, { host: "DESKTOP", now })?.host, "LAPTOP");
		assert.equal(sync.otherHolder(lock, { host: "LAPTOP", now }), null, "our own lock (after a crash) is not a conflict");
		assert.equal(sync.otherHolder(lock, { host: "DESKTOP", now: now + 10 * 60_000 }), null, "stale heartbeat");
		sync.releaseLock(dataDir, "DESKTOP", 1);
		assert.ok(sync.readLock(dataDir), "another computer's lock stays");
		sync.releaseLock(dataDir, "LAPTOP", 42);
		assert.equal(sync.readLock(dataDir), null);
	});

	it("finds OneDrive conflict copies next to their originals", () => {
		const dataDir = dir("conflicts", "data");
		fs.mkdirSync(path.join(dataDir, "chats"));
		for (const f of ["settings.json", "settings-LAPTOP.json", "study-time.json", "chats/chat_ab_12.json", "chats/chat_ab_12-DESKTOP-K3L-2.json", "chats/chat_cd_34.json"]) fs.writeFileSync(path.join(dataDir, f), "{}");
		assert.deepEqual(sync.conflictCopies(dataDir).map((f) => f.replace(/\\/g, "/")).sort(), ["chats/chat_ab_12-DESKTOP-K3L-2.json", "settings-LAPTOP.json"]);
	});
});

describe("course paths on another computer", () => {
	const aliases = parsePathAliases(JSON.stringify([{ from: "C:\\Users\\computer\\Documents\\Ucenje", to: "D:\\OneDrive\\Ucenje" }, { from: "relative", to: "x" }, 5]));

	it("parses only absolute pairs; junk is ignored", () => {
		assert.equal(aliases.length, 1);
		assert.deepEqual(parsePathAliases("{not json"), []);
		assert.deepEqual(parsePathAliases(undefined), []);
	});

	it("opens a missing old path at its synced twin, and leaves existing or unmapped paths alone", () => {
		const exists = (p: string) => p === "D:\\OneDrive\\Ucenje\\Kursevi\\Baze\\slike\\a.jpg" || p === "C:\\here.txt";
		assert.equal(aliasedPath("C:\\Users\\computer\\Documents\\Ucenje\\Kursevi\\Baze\\slike\\a.jpg", aliases, exists), "D:\\OneDrive\\Ucenje\\Kursevi\\Baze\\slike\\a.jpg");
		assert.equal(aliasedPath("C:\\here.txt", aliases, exists), "C:\\here.txt");
		assert.equal(aliasedPath("C:\\Users\\computer\\Documents\\Ucenje\\missing.md", aliases, exists), "C:\\Users\\computer\\Documents\\Ucenje\\missing.md");
		assert.equal(aliasedPath("C:\\Other\\x.md", aliases, exists), "C:\\Other\\x.md");
	});

	it("an allowed folder also allows its synced twin (Read only mode through links)", () => {
		assert.deepEqual(withAliasedFolders(["C:\\Users\\computer\\Documents\\Ucenje"], aliases), ["C:\\Users\\computer\\Documents\\Ucenje", "D:\\OneDrive\\Ucenje"]);
		assert.deepEqual(withAliasedFolders(["C:\\Users\\computer\\Documents\\Ucenje\\Kursevi"], aliases), ["C:\\Users\\computer\\Documents\\Ucenje\\Kursevi", path.join("D:\\OneDrive\\Ucenje", "Kursevi")]);
		assert.deepEqual(withAliasedFolders(["C:\\Users\\computer\\Documents"], aliases), ["C:\\Users\\computer\\Documents", "D:\\OneDrive\\Ucenje"]);
		assert.deepEqual(withAliasedFolders(["E:\\Other"], aliases), ["E:\\Other"]);
	});
});
