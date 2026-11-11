/**
 * Fork (2026-11-11): Test znanja code questions. Authoring rules, the answer
 * text the grader gets (hidden results, photos), the run request parser, and
 * the route running REAL tests from the stored placement_test call — public
 * examples and hidden tests, C++ through a python driver, Python directly.
 *
 * Runs under an isolated LH_DATA_DIR, set before any config-loading import.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-placement-code-"));
process.env.LH_DATA_DIR = TMP_DATA;

type Post = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let POST: Post;
let createChat: (title: string) => { id: string };
let saveMessages: (id: string, messages: unknown[]) => void;
let core: typeof import("../src/core/placement.ts");
let server: typeof import("../src/server/placement-code.ts");

before(async () => {
	POST = (await import("../app/api/chats/[id]/placement-code/route.ts")).POST;
	createChat = (await import("../src/server/chats.ts")).createChat;
	const { chatStore } = await import("../src/store/chats.ts");
	saveMessages = (id, messages) => chatStore.saveMessages(id, messages as never);
	core = await import("../src/core/placement.ts");
	server = await import("../src/server/placement-code.ts");
});
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const has = (cmd: string) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const PY = has("python");
const GXX = PY && has("g++");

/** Python driver: compile answer.txt as C++, feed cases, compare output. */
const cppDriver = (cases: [string, string][]) => `
import shutil, subprocess, sys
shutil.copy("answer.txt", "main.cpp")
c = subprocess.run(["g++", "-std=c++20", "-o", "prog.exe", "main.cpp"], capture_output=True, text=True)
if c.returncode != 0:
    print("Compile error:"); print(c.stderr); sys.exit(1)
cases = ${JSON.stringify(cases)}
bad = 0
for inp, want in cases:
    r = subprocess.run(["./prog.exe"], input=inp, capture_output=True, text=True, timeout=5)
    if r.stdout.strip() != want:
        bad += 1; print(f"input {inp!r}: expected {want}, got {r.stdout.strip()}")
print(f"{len(cases) - bad}/{len(cases)} tests passed")
sys.exit(1 if bad else 0)
`;

const pyTests = (src: string) => ({ program: "python", args: ["-"], code: src });

const codeQ = {
	id: "c1",
	kind: "code" as const,
	question: "Napiši program koji sabira dva broja.",
	language: "cpp" as const,
	correctAnswer: "```cpp\n#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}\n```",
	publicTests: pyTests(cppDriver([["1 2", "3"]])),
	tests: pyTests(cppDriver([["1 2", "3"], ["-5 5", "0"], ["1000000 1", "1000001"]])),
};
const pyQ = {
	id: "p1",
	kind: "code" as const,
	question: "Napiši funkciju kvadrat(x).",
	language: "python" as const,
	correctAnswer: "```python\ndef kvadrat(x): return x * x\n```",
	publicTests: pyTests("exec(open('answer.txt').read())\nassert kvadrat(2) == 4\nprint('1/1 tests passed')"),
	tests: pyTests("import sys\nexec(open('answer.txt').read())\nok = kvadrat(3) == 9 and kvadrat(-4) == 16\nprint('2/2 tests passed' if ok else 'kvadrat is wrong')\nsys.exit(0 if ok else 1)"),
};
const test = { title: "Programiranje", topics: [{ id: "osnove", title: "Osnove", questions: [codeQ, pyQ] }] };

describe("placement code questions — authoring and grading text", () => {
	it("accepts a complete code question and names what is missing", () => {
		assert.deepEqual(core.placementTestProblems(test), []);
		const bare = { ...test, topics: [{ ...test.topics[0]!, questions: [{ ...codeQ, language: undefined, tests: undefined, publicTests: undefined }] }] };
		const p = core.placementTestProblems(bare);
		assert.ok(p.some((x) => /needs language/.test(x)));
		assert.ok(p.some((x) => /needs hidden tests/.test(x)));
		assert.ok(p.some((x) => /needs publicTests/.test(x)));
		const stray = { ...test, topics: [{ ...test.topics[0]!, questions: [{ id: "s", kind: "short" as const, question: "?", correctAnswer: "x", tests: codeQ.tests }] }] };
		assert.ok(core.placementTestProblems(stray).some((x) => /belong only to kind "code"/.test(x)));
	});

	it("carries hidden results, example runs and photos to the grader", () => {
		const long = "x".repeat(5_000);
		const a = JSON.parse(core.placementAnswerText(test, [
			{ qid: "c1", value: "int main(){}", hidden: { status: "failed", exitCode: 1, stdout: long, stderr: "", timedOut: true }, publicRuns: 2, photos: [1, 2] },
			{ qid: "p1", value: "def kvadrat(x): return x*x", hidden: { status: "passed", exitCode: 0, stdout: "2/2 tests passed", stderr: "" } },
		]));
		const [c, p] = a.topics[0].questions;
		assert.equal(c.hiddenTests.status, "failed");
		assert.equal(c.hiddenTests.timedOut, true);
		assert.ok(c.hiddenTests.output.length < 3_100, "long output is clipped");
		assert.equal(c.ranPublicExamples, 2);
		assert.deepEqual(c.photos, [1, 2]);
		assert.equal(p.hiddenTests.status, "passed");
		assert.equal(p.photos, undefined);
		assert.match(a.note, /hiddenTests/);
	});

	it("parses run requests strictly", () => {
		assert.deepEqual(server.parsePlacementRun({ toolCallId: "call_1", qid: "c1", code: "x", which: "public" }), { toolCallId: "call_1", qid: "c1", code: "x", which: "public" });
		assert.match(String(server.parsePlacementRun({ toolCallId: "", qid: "c1", code: "", which: "public" })), /toolCallId/);
		assert.match(String(server.parsePlacementRun({ toolCallId: "x".repeat(301), qid: "c1", code: "", which: "public" })), /toolCallId/);
		assert.match(String(server.parsePlacementRun({ toolCallId: "a", qid: "c1", code: "", which: "all" })), /which/);
		assert.match(String(server.parsePlacementRun({ toolCallId: "a", qid: "c1", code: 5, which: "hidden" })), /code/);
		assert.match(String(server.parsePlacementRun(null)), /toolCallId/);
	});
});

describe("POST /api/chats/:id/placement-code", () => {
	const post = (id: string, body: unknown) =>
		POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
	let chatId = "";
	before(() => {
		chatId = createChat("Test znanja code").id;
		saveMessages(chatId, [
			{ role: "user", content: [{ type: "text", text: "Test znanja" }], timestamp: 1 },
			{ role: "assistant", content: [{ type: "toolCall", id: "call_pt1", name: "placement_test", arguments: test }], timestamp: 2 },
		]);
	});

	it("rejects bad bodies and unknown questions", async () => {
		assert.equal((await post(chatId, { qid: "c1" })).status, 400);
		assert.equal((await post(chatId, { toolCallId: "call_pt1", qid: "nope", code: "", which: "public" })).status, 404);
		assert.equal((await post(chatId, { toolCallId: "call_other", qid: "c1", code: "", which: "public" })).status, 404);
		assert.equal((await post("missing-chat", { toolCallId: "call_pt1", qid: "c1", code: "", which: "public" })).status, 404);
		assert.equal(server.placementCodeQuestion(chatId, "call_pt1", "c1")?.language, "cpp");
	});

	it("runs Python public examples and hidden tests from the stored call", { skip: !PY && "python not on PATH" }, async () => {
		const good = "def kvadrat(x):\n    return x * x\n";
		const pub = await (await post(chatId, { toolCallId: "call_pt1", qid: "p1", code: good, which: "public" })).json();
		assert.equal(pub.status, "passed", JSON.stringify(pub));
		const hid = await (await post(chatId, { toolCallId: "call_pt1", qid: "p1", code: "def kvadrat(x):\n    return x * 2\n", which: "hidden" })).json();
		assert.equal(hid.status, "failed");
		assert.match(hid.stdout, /kvadrat is wrong/);
	});

	it("compiles and tests C++ through the python driver", { skip: !GXX && "python or g++ not on PATH", timeout: 120_000 }, async () => {
		const good = "#include <iostream>\nint main(){ long long a, b; std::cin >> a >> b; std::cout << a + b; }\n";
		const hid = await (await post(chatId, { toolCallId: "call_pt1", qid: "c1", code: good, which: "hidden" })).json();
		assert.equal(hid.status, "passed", JSON.stringify(hid));
		assert.match(hid.stdout, /3\/3 tests passed/);
		const broken = await (await post(chatId, { toolCallId: "call_pt1", qid: "c1", code: "int main( {", which: "public" })).json();
		assert.equal(broken.status, "failed");
		assert.match(broken.stdout, /Compile error/);
		assert.deepEqual(fs.readdirSync(path.join(TMP_DATA, "placement-runs")), [], "run folders are removed");
	});

	it("accepts OpenAI Responses tool-call ids (call_x|fc_y)", { skip: !PY && "python not on PATH" }, async () => {
		assert.equal(typeof server.parsePlacementRun({ toolCallId: "call_a|fc_b", qid: "p1", code: "", which: "public" }), "object");
		const id = "call_abc|fc_def";
		const other = createChat("Test znanja openai id").id;
		saveMessages(other, [
			{ role: "user", content: [{ type: "text", text: "Test znanja" }], timestamp: 1 },
			{ role: "assistant", content: [{ type: "toolCall", id, name: "placement_test", arguments: test }], timestamp: 2 },
		]);
		const r = await (await post(other, { toolCallId: id, qid: "p1", code: "def kvadrat(x):\n    return x * x\n", which: "public" })).json();
		assert.equal(r.status, "passed", JSON.stringify(r));
	});

	it("kills the whole tree at the time limit and removes the folder", { skip: !PY && "python not on PATH", timeout: 60_000 }, async () => {
		// The driver starts a looping grandchild that inherits stdout — the
		// shape that used to hang on 'close' and leave the folder locked.
		const driver = "import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'while True: pass'])\nwhile True: pass\n";
		const started = Date.now();
		const r = await server.runPlacementTests("", pyTests(driver), "looptest", 2_000);
		assert.equal(r.timedOut, true);
		assert.equal(r.status, "failed");
		assert.ok(Date.now() - started < 20_000, "settles soon after the limit");
		const left = fs.readdirSync(path.join(TMP_DATA, "placement-runs")).filter((n) => n.startsWith("looptest"));
		assert.deepEqual(left, [], "run folder removed");
	});

	it("reports a program that cannot start", async () => {
		const r = await server.runPlacementTests("", { program: "lh-no-such-program-xyz", args: [], code: "" }, "nostart");
		assert.equal(r.status, "error");
		assert.match(r.stderr, /Could not start/);
	});
});
