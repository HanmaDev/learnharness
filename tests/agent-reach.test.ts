/**
 * Fork (2026-11-12): the Web search and Access (Read only / Bypass) toggles,
 * the keyless Claude search engine, the Bypass tools, and the teacher's
 * picture reminder on source reads.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { agentAccessMode, webSearchEnabled } from "../src/core/settings-resolution.ts";
import { parseAgentSettingsBody } from "../src/server/settings-body.ts";
import { claudeSearchArgs, parseClaudeSearchOutput } from "../src/server/claude-search.ts";
import { resolveSearchEngineFor } from "../src/server/search.ts";
import { aidTools } from "../src/agent/tools/aids.ts";
import { commandEnv, runCommand, systemAccessTools } from "../src/agent/tools/system-access.ts";
import { pictureReminder, sourcePictures } from "../src/agent/tools/read.ts";
import { resolveWritablePath } from "../src/agent/tools/fs-shared.ts";
import { serverExecute, toolTimeoutMs } from "../src/agent/tool-execute.ts";
import { Type } from "typebox";
import { AUTH_FILE, PATHS } from "../config.ts";
import { composeAccessMode, composeWebSearch } from "../components/settings/agent-section.tsx";

describe("toggles", () => {
	it("default to web search OFF and Read only; read leniently, write strictly", () => {
		assert.equal(webSearchEnabled({ agent: { webSearch: {} } }), false);
		assert.equal(agentAccessMode({ agent: { access: {} } }), "read");
		assert.equal(webSearchEnabled({ agent: { webSearch: { enabled: true } } }), true);
		assert.equal(agentAccessMode({ agent: { access: { mode: "bypass" } } }), "bypass");
		const read = sanitizeUserSettings({ version: 1, agent: { webSearch: { enabled: true }, access: { mode: "bypass" } } })!;
		assert.deepEqual([read.agent?.webSearch, read.agent?.access], [{ enabled: true }, { mode: "bypass" }]);
		const junk = sanitizeUserSettings({ version: 1, agent: { webSearch: { enabled: "yes" }, access: { mode: "root" } } })!;
		assert.deepEqual([junk.agent?.webSearch, junk.agent?.access], [undefined, undefined]);
		assert.equal(composeWebSearch({}, true).webSearch?.enabled, true);
		assert.equal(composeAccessMode({ webSearch: { enabled: true } }, "bypass").access?.mode, "bypass");
	});

	it("the settings PUT body accepts only the known shapes", () => {
		const ok = parseAgentSettingsBody({ webSearch: { enabled: true }, access: { mode: "bypass" } });
		assert.equal(ok.ok, true);
		assert.equal(parseAgentSettingsBody({ access: { mode: "root" } }).ok, false);
		assert.equal(parseAgentSettingsBody({ webSearch: { enabled: 1 } }).ok, false);
	});

	it("tools appear only when switched on", () => {
		assert.deepEqual(Object.keys(aidTools({})), []);
		assert.deepEqual(Object.keys(aidTools({ webSearch: () => null })).sort(), ["web_fetch", "web_search"]);
		assert.deepEqual(Object.keys(aidTools({ systemAccess: true })).sort(), ["edit_file", "run_command", "write_file"]);
	});
});

describe("keyless Claude search", () => {
	it("is the last automatic choice: any keyed engine wins", () => {
		assert.equal(resolveSearchEngineFor(undefined, { claude: "subscription" }).engine, "claude");
		assert.equal(resolveSearchEngineFor(undefined, { claude: "subscription", brave: "k" }).engine, "brave");
		const pinned = resolveSearchEngineFor("claude", {});
		assert.equal(pinned.available, false);
		assert.match(pinned.reason, /Claude Code/);
	});

	it("runs only WebSearch, isolated, and parses the JSON envelope", () => {
		const args = claudeSearchArgs("SQL JOIN", 3);
		assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 4), ["--tools", "WebSearch", "--allowedTools", "WebSearch"]);
		assert.ok(args.includes("--no-session-persistence") && args.includes("--strict-mcp-config"));
		const out = JSON.stringify({ is_error: false, result: 'Here:\n[{"title":"A","url":"https://a.example/x","snippet":"s"},{"title":"bad","url":"javascript:1"},{"url":"http://b.example"}]' });
		assert.deepEqual(parseClaudeSearchOutput(out), [
			{ title: "A", url: "https://a.example/x", snippet: "s" },
			{ title: "http://b.example", url: "http://b.example", snippet: "" },
		]);
		assert.throws(() => parseClaudeSearchOutput(JSON.stringify({ is_error: true, subtype: "error_max_turns" })), /error_max_turns/);
		assert.throws(() => parseClaudeSearchOutput("not json"), /unreadable/);
		assert.throws(() => parseClaudeSearchOutput(JSON.stringify({ result: "no results found" })), /no results/);
		const bracketed = JSON.stringify({ result: 'Top results [1]:\n[{"title":"A","url":"https://a.example","snippet":"x"}]\n[Note: 1 result]' });
		assert.deepEqual(parseClaudeSearchOutput(bracketed).map((h) => h.url), ["https://a.example"], "prose brackets around the array");
	});
});

describe("Bypass tools", () => {
	const tools = systemAccessTools();
	// Tool errors are thrown; the agent loop turns them into error results.
	const call = async (name: string, input: Record<string, unknown>) => {
		try {
			const result = await tools[name]!.execute("t1", input as never, undefined) as { content: Array<{ text?: string }> };
			return { text: result.content.map((c) => c.text ?? "").join(""), isError: false };
		} catch (error) {
			return { text: error instanceof Error ? error.message : String(error), isError: true };
		}
	};
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-bypass-"));

	it("writes, appends and edits files; refuses credential folders and ambiguous edits", async () => {
		const file = path.join(tmp, "nested", "notes.txt");
		assert.match((await call("write_file", { path: file, content: "alpha beta" })).text, /Wrote/);
		await call("write_file", { path: file, content: " beta", append: true });
		assert.equal(fs.readFileSync(file, "utf8"), "alpha beta beta");
		assert.equal((await call("edit_file", { path: file, old_text: "beta", new_text: "gamma" })).isError, true, "two matches need replace_all");
		await call("edit_file", { path: file, old_text: "beta", new_text: "gamma", replace_all: true });
		assert.equal(fs.readFileSync(file, "utf8"), "alpha gamma gamma");
		const denied = await call("write_file", { path: path.join(os.homedir(), ".ssh", "lh-test-should-not-exist"), content: "x" });
		assert.equal(denied.isError, true);
		assert.match(denied.text, /protected location/);
		assert.equal(fs.existsSync(path.join(os.homedir(), ".ssh", "lh-test-should-not-exist")), false);
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it("runs a command with its exit code and output; secrets stay out of its environment", async () => {
		const out = await runCommand(process.platform === "win32" ? "Write-Output 'hi'; exit 3" : "echo hi; exit 3", os.tmpdir(), 30_000);
		assert.match(out, /^exit 3/);
		assert.match(out, /hi/);
		const env = commandEnv({ PATH: "p", TAVILY_API_KEY: "k", GITHUB_TOKEN: "t", LH_AUTH_FILE: "a", PORT: "3000", HOSTNAME: "127.0.0.1", NODE_ENV: "production", ELECTRON_RUN_AS_NODE: "1", __NEXT_PRIVATE_STANDALONE_CONFIG: "{}", APPDATA: "x" } as unknown as NodeJS.ProcessEnv);
		assert.deepEqual(Object.keys(env), ["PATH", "APPDATA"], "no secrets, no server settings");
	});

	it("PowerShell output keeps Serbian letters", { skip: process.platform !== "win32" && "Windows only" }, async () => {
		const out = await runCommand("Write-Output 'Računarstvo čćšđž'", os.tmpdir(), 30_000);
		assert.match(out, /Računarstvo čćšđž/);
	});

	it("never writes into LearnHarness's own folders", () => {
		assert.throws(() => resolveWritablePath(path.join(PATHS.data, "chats", "x.json")), /protected location/);
		assert.throws(() => resolveWritablePath(path.join(path.dirname(AUTH_FILE), "device.json")), /protected location/);
		assert.ok(resolveWritablePath(path.join(os.tmpdir(), "lh-ok.txt")).length > 0);
	});

	it("a tool with its own time limit is not cut at the 30 s default", async () => {
		const previous = toolTimeoutMs.current;
		toolTimeoutMs.current = 50;
		try {
			const slow = (opts?: { timeoutMs?: () => number }) => serverExecute("slow", Type.Object({}), async () => { await new Promise((r) => setTimeout(r, 1_000)); return "done"; }, opts);
			await assert.rejects(slow()("a", {}, undefined) as Promise<unknown>, /timed out/);
			const result = await slow({ timeoutMs: () => 3_000 })("b", {}, undefined) as { content: Array<{ text: string }> };
			assert.equal(result.content[0]!.text, "done");
		} finally {
			toolTimeoutMs.current = previous;
		}
	});

	it("stops a command at its time limit", async () => {
		const started = Date.now();
		const out = await runCommand(process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30", os.tmpdir(), 1_500);
		assert.match(out, /stopped after 1.5 s/);
		assert.ok(Date.now() - started < 15_000);
	});
});

describe("teacher's picture reminder", () => {
	it("lists marker, markdown and <img> pictures with nearby text, resolving relative paths", () => {
		const file = path.join(os.tmpdir(), "course", "lesson.md");
		const text = "## Tabele\n\nTabela STUDENT ima kolone.\n[Slika: C:\\c\\slike\\a.png]\n\n![schema](slike/b.svg)\n<img src=\"https://x.example/c.png\"> <img src='d.jpg'>\n[Slika: C:\\c\\slike\\a.png]";
		const pics = sourcePictures(text, file);
		assert.deepEqual(pics.map((p) => p.path), ["C:\\c\\slike\\a.png", path.resolve(path.dirname(file), "slike/b.svg"), path.resolve(path.dirname(file), "d.jpg")]);
		assert.equal(pics[0]!.near, "Tabela STUDENT ima kolone.");
		const note = pictureReminder(pics);
		assert.match(note, /Pictures in this part \(3\)/);
		assert.match(note, /show_image/);
		assert.equal(pictureReminder([]), "");
		assert.equal(sourcePictures("![rast](slike/50%-graf.png) [Slika: C:\\x\\rast 100%.png]", file).length, 2, "a bare % never breaks the read");
	});
});
