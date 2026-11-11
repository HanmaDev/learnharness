"use client";
/**
 * Fork (placement): the dock for the two placement question tools.
 *  - placement_test: a launcher card; the test opens as a full page — every
 *    topic, quiz / short / math questions, "Ne znam" per question, progress
 *    saved on this device so you can stop and continue. Quiz and math are
 *    graded here (math by the app's check, Wolfram when unsure); short
 *    answers go to the teacher.
 *  - placement_result: per-topic score and the teacher's proposal (Znam /
 *    Ponoviti / Učim od početka) — change any, then confirm.
 * Both answer as kind "ask" with the JSON text from core/placement.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheckIcon, XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { MathField } from "@/components/math-field";
import { mathEquivalent, wolframVerdict } from "@/components/math-check";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cn } from "@/lib/utils";
import {
	PLACEMENT_DECISION_LABELS,
	PLACEMENT_DECISIONS,
	placementAnswerText,
	placementDecisionText,
	quizCorrect,
	type PlacementAnswer,
	type PlacementDecision,
	type PlacementResultInput,
	type PlacementTestInput,
	type QuestionAnswerData,
} from "@/src/core";

const draftKey = (id: string) => `lh:placement:${id}`;

/** Esc closes the page — claimed here, so it never reaches the chat's
 *  abort chain (which would offer to discard the whole test). */
function useEscapeClose(onClose: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
}

/** "iz 2 teme", "iz 5 tema" — Serbian count agreement after "iz". */
export const temaForm = (n: number) => (n % 100 >= 11 && n % 100 <= 14 ? "tema" : n % 10 >= 1 && n % 10 <= 4 ? "teme" : "tema");

function askAnswer(questionText: string, text: string): QuestionAnswerData {
	return { kind: "ask", questionText, dontKnow: false, answers: [], text, answeredAt: new Date().toISOString() } as QuestionAnswerData;
}

function Md({ children, className }: { children: string; className?: string }) {
	return <ToolContentResponse className={cn("lh-prose block", className)}>{children}</ToolContentResponse>;
}

export function PlacementDock({
	tool,
	toolCallId,
	input,
	onSubmit,
	onTalk,
}: {
	tool: "placement_test" | "placement_result";
	toolCallId: string;
	input: PlacementTestInput | PlacementResultInput;
	onSubmit: (answer: QuestionAnswerData) => void;
	/** Say something to the teacher instead ("this test is wrong", "skip it"). */
	onTalk?: (text: string) => Promise<boolean> | boolean | void;
}) {
	const [open, setOpen] = useState(false);
	const [talk, setTalk] = useState<string | null>(null);
	const isTest = tool === "placement_test";
	const test = input as PlacementTestInput;
	const total = isTest ? test.topics.reduce((n, t) => n + t.questions.length, 0) : 0;
	return (
		<div className="flex items-center gap-4 px-4 py-3" data-testid="placement-dock">
			<ClipboardCheckIcon className="size-5 shrink-0 text-success" aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground">{isTest ? "Test znanja" : "Rezultat testa"}</p>
				<p className="truncate text-sm text-foreground">
					{isTest ? `${test.title} · ${total} pitanja iz ${test.topics.length} ${temaForm(test.topics.length)}` : "Pogledaj rezultat po temama i potvrdi šta učimo."}
				</p>
			</div>
			{onTalk && talk === null && (
				<button type="button" onClick={() => setTalk("")} className="shrink-0 cursor-pointer font-ui text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
					Napiši nastavniku
				</button>
			)}
			{onTalk && talk !== null && (
				<span className="flex min-w-0 flex-1 items-center gap-2">
					<input
						autoFocus
						value={talk}
						onChange={(e) => setTalk(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && talk.trim()) {
								void onTalk(talk.trim());
								setTalk(null);
							}
							if (e.key === "Escape") {
								e.stopPropagation();
								setTalk(null);
							}
						}}
						placeholder="npr. „preskoči test” ili „ova pitanja nisu iz mog gradiva”"
						className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none"
					/>
				</span>
			)}
			<button
				type="button"
				data-testid="placement-open"
				onClick={() => setOpen(true)}
				className="shrink-0 cursor-pointer rounded-md bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success"
			>
				{isTest ? "Otvori test" : "Otvori rezultat"}
			</button>
			{open &&
				(isTest ? (
					<PlacementTestPage test={test} toolCallId={toolCallId} onClose={() => setOpen(false)} onSubmit={onSubmit} />
				) : (
					<PlacementResultPage result={input as PlacementResultInput} onClose={() => setOpen(false)} onSubmit={onSubmit} />
				))}
		</div>
	);
}

type Draft = Record<string, { value: string | string[]; dontKnow?: boolean }>;

function PlacementTestPage({ test, toolCallId, onClose, onSubmit }: { test: PlacementTestInput; toolCallId: string; onClose: () => void; onSubmit: (a: QuestionAnswerData) => void }) {
	const [draft, setDraft] = useState<Draft>(() => {
		try {
			return JSON.parse(window.localStorage.getItem(draftKey(toolCallId)) ?? "{}") as Draft;
		} catch {
			return {};
		}
	});
	const [grading, setGrading] = useState(false);
	const [confirmEmpty, setConfirmEmpty] = useState(false);
	useEffect(() => {
		try {
			window.localStorage.setItem(draftKey(toolCallId), JSON.stringify(draft));
		} catch {
			/* storage blocked: the test still works */
		}
	}, [draft, toolCallId]);
	useEscapeClose(onClose);

	const all = useMemo(() => test.topics.flatMap((t) => t.questions), [test]);
	const answered = all.filter((q) => {
		const d = draft[q.id];
		return d?.dontKnow || (Array.isArray(d?.value) ? d.value.length > 0 : !!String(d?.value ?? "").trim());
	}).length;
	const set = (qid: string, v: Partial<Draft[string]>) => setDraft((d) => ({ ...d, [qid]: { value: d[qid]?.value ?? "", ...d[qid], ...v } }));

	const submit = async () => {
		if (answered < all.length && !confirmEmpty) {
			setConfirmEmpty(true);
			return;
		}
		setGrading(true);
		const answers: PlacementAnswer[] = [];
		for (const q of all) {
			const d = draft[q.id];
			if (!d || d.dontKnow) {
				answers.push({ qid: q.id, value: "", dontKnow: true, ...(q.kind !== "short" ? { correct: false } : {}) });
				continue;
			}
			if (q.kind === "quiz") {
				const chosen = Array.isArray(d.value) ? d.value : [d.value];
				answers.push({ qid: q.id, value: chosen, correct: quizCorrect(q, chosen) });
			} else if (q.kind === "math") {
				const given = String(d.value);
				let verdict = given.trim() ? await mathEquivalent(String(q.correctAnswer), given) : "different";
				let by: "wolfram" | undefined;
				if (verdict === "undecided") {
					const w = await wolframVerdict(String(q.correctAnswer), given);
					if (w !== "undecided") {
						verdict = w;
						by = "wolfram";
					}
				}
				answers.push({ qid: q.id, value: given, ...(verdict !== "undecided" ? { correct: verdict === "equal" } : {}), ...(by ? { checkedBy: by } : {}) });
			} else answers.push({ qid: q.id, value: String(d.value) });
		}
		// The draft stays until the question actually leaves (the dock unmounts
		// then); a refused/offline send keeps every answer and re-enables the button.
		onSubmit(askAnswer(test.title, placementAnswerText(test, answers)));
		setTimeout(() => setGrading(false), 2_000);
	};

	let n = 0;
	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background font-prose" role="dialog" aria-label="Test znanja" data-testid="placement-test">
			<div className="flex items-center gap-4 border-b border-border px-8 py-4">
				<div className="min-w-0 flex-1">
					<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Test znanja</p>
					<h1 className="truncate font-title text-3xl tracking-tight">{test.title}</h1>
				</div>
				<span className="font-ui text-sm text-muted-foreground" data-testid="placement-progress">
					{answered} / {all.length} odgovoreno
				</span>
				<button type="button" aria-label="Zatvori (odgovori ostaju sačuvani)" title="Zatvori — odgovori ostaju sačuvani" onClick={onClose} className="cursor-pointer rounded p-1.5 text-muted-foreground hover:text-foreground">
					<XIcon className="size-5" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-4xl px-8 py-8">
					{test.intro && <p className="mb-6 text-lg text-foreground/85">{test.intro}</p>}
					{test.topics.map((t) => (
						<section key={t.id} className="mb-10">
							<h2 className="mb-4 border-b border-border pb-2 font-title text-2xl tracking-tight">{t.title}</h2>
							{t.questions.map((q) => {
								n++;
								const d = draft[q.id];
								const multi = Array.isArray(q.correctAnswer) && q.correctAnswer.length > 1;
								const chosen = Array.isArray(d?.value) ? d.value : d?.value ? [d.value] : [];
								return (
									<div key={q.id} className={cn("mb-6 rounded-lg border border-border bg-white/[0.03] px-5 py-4", d?.dontKnow && "opacity-60")} data-testid="placement-question">
										<div className="flex gap-3">
											<span className="font-ui text-sm text-muted-foreground">{n}.</span>
											<Md className="min-w-0 flex-1 text-lg">{q.question}</Md>
										</div>
										<div className="mt-3 pl-7">
											{q.kind === "quiz" && (
												<div className="flex flex-col gap-2">
													{(q.options ?? []).map((o) => {
														const on = chosen.includes(o.value);
														return (
															<button
																key={o.value}
																type="button"
																disabled={d?.dontKnow}
																onClick={() => set(q.id, { value: multi ? (on ? chosen.filter((v) => v !== o.value) : [...chosen, o.value]) : [o.value] })}
																className={cn(
																	"flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left text-base transition-colors disabled:cursor-default",
																	on ? "border-success! bg-success/10" : "border-border hover:bg-accent",
																)}
															>
																<span className={cn("size-3.5 shrink-0 border border-muted-foreground", multi ? "rounded-sm" : "rounded-full", on && "border-success! bg-success")} />
																<Md>{o.label}</Md>
															</button>
														);
													})}
													{multi && <p className="text-xs text-muted-foreground">Više tačnih odgovora.</p>}
												</div>
											)}
											{q.kind === "short" && (
												<textarea
													value={String(d?.value ?? "")}
													disabled={d?.dontKnow}
													onChange={(e) => set(q.id, { value: e.target.value })}
													rows={3}
													placeholder="Tvoj odgovor…"
													className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-base outline-none focus:border-foreground/40!"
												/>
											)}
											{q.kind === "math" && (
												<div className="rounded-md border border-border bg-background px-3 py-2">
													<MathField value={String(d?.value ?? "")} onChange={(latex) => set(q.id, { value: latex })} ariaLabel={`Odgovor na pitanje ${n}`} placeholder="Upiši formulu…" />
												</div>
											)}
											<label className="mt-2 flex w-fit cursor-pointer items-center gap-2 font-ui text-xs uppercase tracking-wider text-muted-foreground">
												<input type="checkbox" checked={!!d?.dontKnow} onChange={(e) => set(q.id, { dontKnow: e.target.checked })} /> Ne znam
											</label>
										</div>
									</div>
								);
							})}
						</section>
					))}
				</div>
			</div>
			<div className="flex items-center justify-end gap-4 border-t border-border px-8 py-4">
				{confirmEmpty && answered < all.length && <span className="text-sm text-warning">{all.length - answered} pitanja bez odgovora računaju se kao „ne znam”. Klikni ponovo da predaš.</span>}
				<button
					type="button"
					data-testid="placement-submit"
					disabled={grading}
					onClick={() => void submit()}
					className="flex cursor-pointer items-center gap-2 rounded-md bg-success px-5 py-2.5 text-base font-medium text-white hover:bg-success disabled:cursor-wait disabled:opacity-60"
				>
					{grading && <BrailleSpinner label="Ocenjujem" />} Predaj test
				</button>
			</div>
		</div>
	);
}

function PlacementResultPage({ result, onClose, onSubmit }: { result: PlacementResultInput; onClose: () => void; onSubmit: (a: QuestionAnswerData) => void }) {
	const [decisions, setDecisions] = useState<Record<string, PlacementDecision>>(() => Object.fromEntries(result.topics.map((t) => [t.id, t.proposal])));
	useEscapeClose(onClose);
	const counts = PLACEMENT_DECISIONS.map((d) => [d, result.topics.filter((t) => decisions[t.id] === d).length] as const);
	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background font-prose" role="dialog" aria-label="Rezultat testa" data-testid="placement-result">
			<div className="flex items-center gap-4 border-b border-border px-8 py-4">
				<div className="min-w-0 flex-1">
					<p className="font-ui text-xs uppercase tracking-widest text-muted-foreground">Rezultat testa</p>
					<h1 className="font-title text-3xl tracking-tight">Šta znaš, a šta učimo</h1>
				</div>
				<button type="button" aria-label="Zatvori" onClick={onClose} className="cursor-pointer rounded p-1.5 text-muted-foreground hover:text-foreground">
					<XIcon className="size-5" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-4xl px-8 py-8">
					{result.summary && <p className="mb-6 text-lg text-foreground/85">{result.summary}</p>}
					<div className="flex flex-col gap-3">
						{result.topics.map((t) => (
							<div key={t.id} className="rounded-lg border border-border bg-white/[0.035] px-5 py-4" data-testid="placement-topic">
								<div className="flex flex-wrap items-center gap-4">
									<div className="min-w-0 flex-1">
										<p className="text-xl text-foreground">{t.title}</p>
										{t.note && <p className="mt-0.5 text-sm text-muted-foreground">{t.note}</p>}
									</div>
									<div className="flex w-44 items-center gap-2">
										<span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
											<span className={cn("block h-full rounded-full", t.score >= 80 ? "bg-success" : t.score >= 50 ? "bg-warning" : "bg-error")} style={{ width: `${Math.round(t.score)}%` }} />
										</span>
										<span className="w-10 text-right font-ui text-sm text-foreground">{Math.round(t.score)}%</span>
									</div>
									<div className="flex rounded-md border border-border p-0.5">
										{PLACEMENT_DECISIONS.map((d) => (
											<button
												key={d}
												type="button"
												onClick={() => setDecisions((x) => ({ ...x, [t.id]: d }))}
												className={cn(
													"cursor-pointer rounded px-3 py-1 font-ui text-xs uppercase tracking-wider",
													decisions[t.id] === d ? (d === "znam" ? "bg-success text-white" : d === "ponoviti" ? "bg-warning text-black" : "bg-error/80 text-white") : "text-muted-foreground hover:text-foreground",
												)}
											>
												{PLACEMENT_DECISION_LABELS[d]}
											</button>
										))}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
			<div className="flex items-center justify-end gap-4 border-t border-border px-8 py-4">
				<span className="font-ui text-sm text-muted-foreground">{counts.map(([d, c]) => `${PLACEMENT_DECISION_LABELS[d]}: ${c}`).join(" · ")}</span>
				<button
					type="button"
					data-testid="placement-confirm"
					onClick={() => onSubmit(askAnswer("Rezultat testa", placementDecisionText(result, decisions)))}
					className="cursor-pointer rounded-md bg-success px-5 py-2.5 text-base font-medium text-white hover:bg-success"
				>
					Potvrdi i napravi plan
				</button>
			</div>
		</div>
	);
}

/** The transcript's record of an answered placement step (no answer keys). */
export function PlacementSummary({ tool, output }: { tool: string; output: unknown }) {
	const out = (output ?? {}) as { text?: unknown; dismissed?: unknown; setAside?: unknown };
	const text = out.text;
	let line = out.dismissed || out.setAside ? (tool === "placement_test" ? "Test znanja odbačen." : "Rezultat testa odbačen.") : tool === "placement_test" ? "Test znanja predat." : "Plan potvrđen.";
	try {
		const j = JSON.parse(typeof text === "string" ? text : "{}") as { topics?: Array<{ autoGraded?: string }>; placementDecisions?: Array<{ decision: string }> };
		if (j.topics) {
			const [r, t] = j.topics.reduce(([a, b], x) => { const [p, q] = (x.autoGraded ?? "0/0").split("/").map(Number); return [a + (p || 0), b + (q || 0)]; }, [0, 0]);
			line = `Test znanja predat · ${j.topics.length} ${j.topics.length % 10 >= 2 && j.topics.length % 10 <= 4 && (j.topics.length % 100 < 12 || j.topics.length % 100 > 14) ? "teme" : "tema"} · automatski ocenjeno ${r}/${t}`;
		}
		if (j.placementDecisions) {
			const c = (d: string) => j.placementDecisions!.filter((x) => x.decision === d).length;
			line = `Plan potvrđen · Znam ${c("znam")} · Ponoviti ${c("ponoviti")} · Učim ${c("ucim")}`;
		}
	} catch {
		/* plain line */
	}
	return (
		<div className="my-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 font-ui text-xs uppercase tracking-wider text-muted-foreground" data-testid="placement-summary">
			<ClipboardCheckIcon className="size-4 text-success" aria-hidden /> {line}
		</div>
	);
}
