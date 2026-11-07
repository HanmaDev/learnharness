"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, GripVerticalIcon, XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { PathInput } from "@/components/path-input";
import { finishDictation, isDictationActive, joinDictation, useDictationTarget } from "@/components/dictation";
import { useDictationGhost } from "@/components/dictation-state";
import { CONFIDENCE_COLORS, confidenceRailStyle } from "@/components/confidence-rail";
import {
	buildExerciseAnswer,
	CONFIDENCE_STOPS,
	DEFAULT_CONFIDENCE_INDEX,
	exerciseResponseComplete,
	exerciseShuffle,
	templateSegments,
	type ExerciseAnswer,
	type ExerciseResponse,
	type ExerciseToolInput,
	type QuestionAnswerData,
} from "@/src/core";
import { cn } from "@/lib/utils";
import { PhotoTray, usePhotoAttachments } from "@/components/photo-attach";
import { CodeEditor } from "@/components/code-editor";
import { MathField } from "@/components/math-field";
import { mathEquivalent } from "@/components/math-check";
import { describeSchema, runSql, type SqlRun } from "@/components/sql-runner";
import { buildDemoSrcDoc, INITIAL_DEMO_BRIDGE_STATE, reduceDemoBridgeState, type DemoBridgeState } from "@/components/artifacts/demo-card";
import { htmlPreviewDocument } from "@/components/artifacts/html-preview-card";
import { sqlMatchesWithTies, sqlVerdict, sqlWithOrderKeys, type SqlCell } from "@/src/core";

/**
 * Fork (2026-11-07): the `exercise` question's form — blanks, order,
 * find-mistake, match — plus the shared answer tail (I don't know,
 * confidence, your thinking, submit). Graded in the app on submit
 * (core/exercise.ts); the teacher reads the itemized result.
 */

const MONO = "font-mono text-[13px] leading-6";

/** Fork review fix: the form's in-progress state survives a remount (a
 *  failed submit rolls the optimistic answer back and remounts the dock),
 *  keyed by the question's call id, for the life of the window. */
interface ExerciseDraft {
	response: ExerciseResponse | null;
	dontKnow: boolean;
	confIdx: number;
	thinking: string;
}
const drafts = new Map<string, ExerciseDraft>();

export function ExerciseForm({
	input,
	toolCallId,
	toolName = "exercise",
	onSubmit,
	onEscape,
	dictationClaim = true,
	compactionRunning = false,
}: {
	input: ExerciseToolInput;
	toolCallId: string;
	toolName?: string;
	onSubmit: (output: QuestionAnswerData) => void;
	onEscape?: () => void;
	dictationClaim?: boolean;
	compactionRunning?: boolean;
}) {
	const draft = drafts.get(toolCallId);
	const [response, setResponse] = useState<ExerciseResponse | null>(() => draft?.response ?? initialResponse(input, toolCallId));
	const [dontKnow, setDontKnow] = useState(draft?.dontKnow ?? false);
	const [confIdx, setConfIdx] = useState(draft?.confIdx ?? DEFAULT_CONFIDENCE_INDEX);
	const [thinking, setThinking] = useState(draft?.thinking ?? "");
	const thinkingRef = useRef(draft?.thinking ?? "");
	const submittingRef = useRef(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const photos = usePhotoAttachments();
	useEffect(() => {
		drafts.set(toolCallId, { response, dontKnow, confIdx, thinking });
	}, [toolCallId, response, dontKnow, confIdx, thinking]);

	// Tab walks the form's own fields (gaps, steps, lines, items, thinking).
	// The window-level Tab is the app's field cycle; claim it at document
	// level like the quiz dock does, only while focus is inside this form.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
			const root = rootRef.current;
			if (!root || !root.contains(document.activeElement)) return;
			const fields = [...root.querySelectorAll<HTMLElement>("[data-exercise-focus]")];
			if (fields.length === 0) return;
			e.preventDefault();
			e.stopPropagation();
			const at = fields.findIndex((f) => f === document.activeElement || f.contains(document.activeElement));
			const next = fields[(at + (e.shiftKey ? fields.length - 1 : 1)) % fields.length] ?? fields[0]!;
			next.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	const dictationAppend = useCallback((t: string) => {
		const v = joinDictation(thinkingRef.current, t);
		thinkingRef.current = v;
		setThinking(v);
	}, []);
	useDictationTarget(dictationAppend, dictationClaim);
	const ghost = useDictationGhost(dictationAppend);

	const complete = dontKnow || exerciseResponseComplete(input, response);
	const canSubmit = complete && !compactionRunning;

	const submit = async () => {
		if (!canSubmit || submittingRef.current || photos.uploading) return;
		submittingRef.current = true;
		try {
			if (isDictationActive()) await finishDictation();
			let finalResponse = dontKnow ? null : response;
			if (finalResponse?.format === "sql") finalResponse = await gradeSqlResponse(input, finalResponse.query);
			if (finalResponse?.format === "math") {
				finalResponse = { format: "math", latex: finalResponse.latex, verdict: await mathEquivalent(input.answerLatex ?? "", finalResponse.latex, input.acceptLatex) };
			}
			const answer = buildExerciseAnswer(
				input,
				{ response: finalResponse, dontKnow, thinking: thinkingRef.current, confidence: dontKnow ? undefined : CONFIDENCE_STOPS[confIdx] },
				toolName,
			);
			if (photos.ids.length) answer.images = photos.ids;
			onSubmit(answer);
		} finally {
			// A refused send keeps the form (and its draft) usable for a retry.
			submittingRef.current = false;
		}
	};

	return (
		<div ref={rootRef} data-testid="exercise-form" data-format={input.format}>
			<div className="px-4 pt-3 pb-2">
				<div className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{input.type === "predict" ? "Prediction" : "Exercise"} · {FORMAT_LABEL[input.format]}
				</div>
				<ToolContentResponse>{input.question}</ToolContentResponse>
				{input.details && <ToolContentResponse className="mt-1 text-sm text-muted-foreground">{input.details}</ToolContentResponse>}
			</div>
			<div className={cn("px-4 pb-3", dontKnow && "pointer-events-none opacity-40")}>
				{input.format === "blanks" && response?.format === "blanks" && (
					<BlanksField input={input} values={response.values} onChange={(values) => setResponse({ format: "blanks", values })} onSubmit={() => void submit()} />
				)}
				{input.format === "order" && response?.format === "order" && (
					<OrderField input={input} order={response.order} onChange={(order) => setResponse({ format: "order", order })} />
				)}
				{input.format === "find-mistake" && response?.format === "find-mistake" && (
					<MistakeField input={input} line={response.line} onChange={(line) => setResponse({ format: "find-mistake", line })} />
				)}
				{input.format === "match" && response?.format === "match" && (
					<MatchField input={input} toolCallId={toolCallId} picks={response.picks} onChange={(picks) => setResponse({ format: "match", picks })} />
				)}
				{input.format === "sql" && response?.format === "sql" && (
					<SqlField input={input} query={response.query} onChange={(query) => setResponse({ format: "sql", query, matched: false, columns: [], rows: [] })} />
				)}
				{input.format === "html" && response?.format === "html" && (
					<HtmlField code={response.code} onChange={(code) => setResponse({ format: "html", code })} />
				)}
				{input.format === "math" && response?.format === "math" && (
					<MathField
						value={response.latex}
						onChange={(latex) => setResponse({ format: "math", latex, verdict: "undecided" })}
						onEnter={() => void submit()}
						ariaLabel="Your answer"
						testId="exercise-math"
						placeholder="Your answer"
					/>
				)}
			</div>
			<div className="flex items-center gap-3 border-t border-border/60 px-4 py-2">
				<button
					type="button"
					data-testid="exercise-dont-know"
					aria-pressed={dontKnow}
					onClick={() => setDontKnow((v) => !v)}
					className={cn(
						"shrink-0 rounded-md border px-2 py-1 font-mono text-xs transition-colors",
						dontKnow ? "border-primary bg-accent text-foreground" : "border-border/70 text-muted-foreground hover:bg-accent/50",
					)}
				>
					I don&apos;t know
				</button>
				<span className={cn("shrink-0 text-xs font-medium uppercase tracking-wide", dontKnow ? "text-muted-foreground/50" : "text-muted-foreground")}>
					Confidence
				</span>
				<div className={cn("relative h-4 min-w-0 flex-1", dontKnow && "opacity-40")}>
					<div
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-2 right-2 h-1.5 -translate-y-1/2 rounded-full border border-border"
						style={confidenceRailStyle(CONFIDENCE_STOPS[confIdx]!)}
					/>
					<input
						type="range"
						min={0}
						max={100}
						step={1}
						value={CONFIDENCE_STOPS[confIdx]}
						disabled={dontKnow}
						aria-label="Confidence — the probability your answer is correct"
						data-testid="exercise-confidence"
						onChange={(e) => {
							const v = Number(e.target.value);
							let best = 0;
							for (let i = 1; i < CONFIDENCE_STOPS.length; i++) {
								if (Math.abs(CONFIDENCE_STOPS[i]! - v) < Math.abs(CONFIDENCE_STOPS[best]! - v)) best = i;
							}
							setConfIdx(best);
						}}
						style={{ color: CONFIDENCE_COLORS[confIdx] }}
						className={cn(
							"absolute inset-0 h-4 w-full cursor-pointer appearance-none bg-transparent outline-none",
							"[&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent",
							"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current",
						)}
					/>
				</div>
				<span className="w-9 shrink-0 text-right font-mono text-sm tabular-nums">{dontKnow ? "—" : `${CONFIDENCE_STOPS[confIdx]}%`}</span>
			</div>
			<form
				className="border-t border-border/60 p-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<div {...photos.areaProps} className="rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50">
					<div className="px-2.5 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{input.format === "find-mistake" ? "Why is it wrong?" : "Your thinking"}
					</div>
					<div className="flex items-end gap-2">
						<PathInput
							data-exercise-focus=""
							value={thinking}
							ghostText={ghost}
							onValueChange={(v) => {
								thinkingRef.current = v;
								setThinking(v);
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape" && onEscape) {
									e.preventDefault();
									e.stopPropagation();
									onEscape();
									return;
								}
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									void submit();
								}
							}}
							placeholder={input.format === "find-mistake" ? "What's wrong with that line, and what should it be?" : "Why this answer? Whatever comes to mind."}
							className="field-sizing-content lh-input max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-2 outline-none"
						/>
						<button
							type="submit"
							data-testid="exercise-submit"
							disabled={!canSubmit}
							className="m-1 shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
						>
							Submit
						</button>
					</div>
					<PhotoTray attach={photos} disabled={compactionRunning} />
				</div>
				<div className="px-1 pt-1 text-[11px] text-muted-foreground/70">
					{compactionRunning ? "Compacting context — submit when it finishes." : complete ? "Ctrl+Enter submits" : HINT[input.format]}
				</div>
			</form>
		</div>
	);
}

const FORMAT_LABEL: Record<ExerciseToolInput["format"], string> = {
	blanks: "fill in the blanks",
	order: "put in order",
	"find-mistake": "find the mistake",
	match: "match pairs",
	sql: "write the query",
	html: "write the markup",
	math: "your answer",
};
const HINT: Record<ExerciseToolInput["format"], string> = {
	blanks: "Fill every gap (Tab moves to the next).",
	order: "Drag the steps, or use the arrows (Alt+↑/↓ on a focused step).",
	"find-mistake": "Click the line that's wrong.",
	match: "Click a left item, then its partner on the right.",
	sql: "Write a query; Ctrl+Enter runs it. Submit when the result looks right.",
	html: "Edit the markup; the preview updates as you type.",
	math: "Type like on paper: / fraction, ^ power, sqrt root. Enter submits.",
};

const MAX_SHOWN_ROWS = 50;

/** Run his query and the reference against fresh copies of the database and compare. */
async function gradeSqlResponse(input: ExerciseToolInput, query: string): Promise<ExerciseResponse> {
	const setup = input.setupSql ?? "";
	const [got, ref] = await Promise.all([runSql(setup, query), runSql(setup, input.referenceSql ?? "")]);
	if (!got.ok) return { format: "sql", query, matched: false, columns: [], rows: [], error: got.error, expectedRows: ref.ok ? ref.rows.length : undefined };
	let verdict: { matched: boolean; orderUnverified?: boolean } = ref.ok ? sqlVerdict(ref, got, input.referenceSql ?? "", query) : { matched: false };
	// Same rows, different order, sorted reference: decide EXACTLY by re-running
	// the reference with its sort keys, so ties may order freely and nothing else.
	if (ref.ok && verdict.orderUnverified) {
		const keyed = sqlWithOrderKeys(input.referenceSql ?? "");
		const keyedRun = keyed ? await runSql(setup, keyed.sql) : null;
		if (keyed && keyedRun?.ok) verdict = { matched: sqlMatchesWithTies(keyedRun, keyed.keys, ref.columns.length, got) };
	}
	return { format: "sql", query, ...verdict, columns: got.columns, rows: got.rows.slice(0, MAX_SHOWN_ROWS), expectedRows: ref.ok ? ref.rows.length : undefined };
}

function initialResponse(input: ExerciseToolInput, seed: string): ExerciseResponse | null {
	switch (input.format) {
		case "blanks":
			return { format: "blanks", values: (input.blanks ?? []).map(() => "") };
		case "order":
			return { format: "order", order: exerciseShuffle(input.steps?.length ?? 0, `${seed}:order`) };
		case "find-mistake":
			return { format: "find-mistake", line: 0 };
		case "match":
			return { format: "match", picks: (input.pairs ?? []).map(() => -1) };
		case "sql":
			return { format: "sql", query: input.starterCode ?? "", matched: false, columns: [], rows: [] };
		case "html":
			return { format: "html", code: input.starterCode ?? "" };
		case "math":
			return { format: "math", latex: "", verdict: "undecided" };
		default:
			return null;
	}
}

// ─── blanks ─────────────────────────────────────────────────────────────────

function BlanksField({ input, values, onChange, onSubmit }: { input: ExerciseToolInput; values: string[]; onChange: (v: string[]) => void; onSubmit: () => void }) {
	const segments = useMemo(() => templateSegments(input.template ?? ""), [input.template]);
	const code = !!input.language;
	return (
		<div
			data-testid="exercise-blanks"
			className={cn("rounded-lg border bg-muted/40 px-3 py-2 whitespace-pre-wrap", code ? MONO : "text-sm leading-7")}
		>
			{segments.map((seg, i) =>
				"text" in seg ? (
					<span key={i}>{seg.text}</span>
				) : (
					<input
						key={i}
						data-exercise-focus=""
						data-testid={`exercise-gap-${seg.gap + 1}`}
						aria-label={`Gap ${seg.gap + 1}`}
						value={values[seg.gap] ?? ""}
						onChange={(e) => {
							const next = [...values];
							next[seg.gap] = e.target.value;
							onChange(next);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								onSubmit();
							}
						}}
						size={Math.max(4, ...(input.blanks?.[seg.gap]?.accept ?? []).map((a) => a.length + 1))}
						className={cn("mx-0.5 rounded border border-primary/50 bg-background px-1 align-baseline outline-none focus:border-primary", code && "font-mono")}
						placeholder={`${seg.gap + 1}`}
						autoComplete="off"
						spellCheck={false}
					/>
				),
			)}
		</div>
	);
}

// ─── order ──────────────────────────────────────────────────────────────────

function OrderField({ input, order, onChange }: { input: ExerciseToolInput; order: number[]; onChange: (o: number[]) => void }) {
	const steps = input.steps ?? [];
	const [dragFrom, setDragFrom] = useState<number | null>(null);
	const move = (from: number, to: number) => {
		if (to < 0 || to >= order.length || from === to) return;
		const next = [...order];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item!);
		onChange(next);
	};
	return (
		<ol data-testid="exercise-order" className="flex flex-col gap-1.5">
			{order.map((stepIdx, pos) => (
				<li
					key={stepIdx}
					draggable
					tabIndex={0}
					data-exercise-focus=""
					data-testid={`exercise-step-${pos + 1}`}
					onDragStart={() => setDragFrom(pos)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						e.preventDefault();
						if (dragFrom !== null) move(dragFrom, pos);
						setDragFrom(null);
					}}
					onKeyDown={(e) => {
						if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
							e.preventDefault();
							move(pos, pos + (e.key === "ArrowUp" ? -1 : 1));
						}
					}}
					className={cn(
						"flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 outline-none focus:border-primary/60",
						dragFrom === pos && "opacity-50",
					)}
				>
					<GripVerticalIcon className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
					<span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{pos + 1}.</span>
					<span className={cn("min-w-0 flex-1 whitespace-pre-wrap", input.language ? MONO : "text-sm")}>{steps[stepIdx]}</span>
					<button type="button" aria-label="Move up" disabled={pos === 0} onClick={() => move(pos, pos - 1)} className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30">
						<ArrowUpIcon className="size-3.5" />
					</button>
					<button type="button" aria-label="Move down" disabled={pos === order.length - 1} onClick={() => move(pos, pos + 1)} className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30">
						<ArrowDownIcon className="size-3.5" />
					</button>
				</li>
			))}
		</ol>
	);
}

// ─── find the mistake ───────────────────────────────────────────────────────

function MistakeField({ input, line, onChange }: { input: ExerciseToolInput; line: number; onChange: (l: number) => void }) {
	return (
		<div data-testid="exercise-lines" role="radiogroup" className="overflow-x-auto rounded-lg border bg-muted/40 py-1">
			{(input.lines ?? []).map((text, i) => (
				<button
					key={i}
					type="button"
					role="radio"
					data-exercise-focus=""
					aria-checked={line === i + 1}
					data-testid={`exercise-line-${i + 1}`}
					onClick={() => onChange(i + 1)}
					className={cn(
						"flex w-full items-start gap-3 px-3 text-left transition-colors hover:bg-accent/50",
						line === i + 1 && "bg-amber-500/15 outline outline-1 outline-amber-500/60",
					)}
				>
					<span className={cn("w-6 shrink-0 text-right text-muted-foreground", MONO)}>{i + 1}</span>
					<span className={cn("min-w-0 flex-1 whitespace-pre-wrap", input.language ? MONO : "py-0.5 text-sm")}>{text}</span>
				</button>
			))}
		</div>
	);
}

// ─── match ──────────────────────────────────────────────────────────────────

const PAIR_COLORS = ["bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-fuchsia-500", "bg-orange-500", "bg-teal-500", "bg-rose-500", "bg-lime-500", "bg-indigo-500", "bg-yellow-500"];

function MatchField({ input, toolCallId, picks, onChange }: { input: ExerciseToolInput; toolCallId: string; picks: number[]; onChange: (p: number[]) => void }) {
	const pairs = input.pairs ?? [];
	const rightOrder = useMemo(() => exerciseShuffle(pairs.length, `${toolCallId}:match`), [pairs.length, toolCallId]);
	const [active, setActive] = useState<number | null>(null);
	const colorOf = (left: number) => PAIR_COLORS[left % PAIR_COLORS.length]!;
	const leftForRight = (right: number) => picks.findIndex((p) => p === right);
	const pickRight = (right: number) => {
		const holder = leftForRight(right);
		const next = [...picks];
		if (active === null) {
			if (holder >= 0) next[holder] = -1; // click a paired right item: unpair it
			onChange(next);
			return;
		}
		if (holder >= 0) next[holder] = -1;
		next[active] = right;
		onChange(next);
		setActive(null);
	};
	return (
		<div data-testid="exercise-match" className="grid grid-cols-2 gap-x-4 gap-y-1.5">
			<div className="flex flex-col gap-1.5">
				{pairs.map((p, left) => (
					<button
						key={left}
						type="button"
						data-exercise-focus=""
						data-testid={`exercise-left-${left + 1}`}
						aria-pressed={active === left}
						onClick={() => setActive(active === left ? null : left)}
						className={cn(
							"flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50",
							active === left && "border-primary ring-1 ring-primary",
						)}
					>
						<span className={cn("size-2.5 shrink-0 rounded-full", picks[left]! >= 0 ? colorOf(left) : "bg-muted-foreground/30")} />
						<span className={cn("min-w-0 flex-1", input.language && MONO)}>{p.left}</span>
					</button>
				))}
			</div>
			<div className="flex flex-col gap-1.5">
				{rightOrder.map((right) => {
					const holder = leftForRight(right);
					return (
						<button
							key={right}
							type="button"
							data-exercise-focus=""
							data-testid={`exercise-right-${right + 1}`}
							onClick={() => pickRight(right)}
							className={cn("flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50", active !== null && "border-primary/40")}
						>
							<span className={cn("size-2.5 shrink-0 rounded-full", holder >= 0 ? colorOf(holder) : "bg-muted-foreground/30")} />
							<span className={cn("min-w-0 flex-1", input.language && MONO)}>{pairs[right]!.right}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ─── sql ────────────────────────────────────────────────────────────────────

export function ResultTable({ columns, rows, testId }: { columns: string[]; rows: SqlCell[][]; testId?: string }) {
	if (columns.length === 0) return <div className="text-xs text-muted-foreground">(no rows)</div>;
	return (
		<div className="max-h-64 overflow-auto rounded-lg border" data-testid={testId}>
			<table className="w-full border-collapse font-mono text-xs">
				<thead className="sticky top-0 bg-card">
					<tr>{columns.map((c, i) => <th key={i} className="border-b px-2 py-1 text-left font-medium">{c}</th>)}</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={i} className="odd:bg-muted/30">
							{r.map((v, j) => <td key={j} className="border-b border-border/40 px-2 py-0.5">{v === null ? <span className="text-muted-foreground">NULL</span> : String(v)}</td>)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function SqlField({ input, query, onChange }: { input: ExerciseToolInput; query: string; onChange: (q: string) => void }) {
	const [run, setRun] = useState<SqlRun | null>(null);
	const [running, setRunning] = useState(false);
	const [schema, setSchema] = useState<Array<{ table: string; columns: string[]; rows: number }>>([]);
	const [showSetup, setShowSetup] = useState(false);
	useEffect(() => {
		let live = true;
		void describeSchema(input.setupSql ?? "").then((s) => live && setSchema(s)).catch(() => {});
		return () => { live = false; };
	}, [input.setupSql]);
	const execute = async () => {
		if (!query.trim()) return;
		setRunning(true);
		try {
			setRun(await runSql(input.setupSql ?? "", query));
		} catch (err) {
			setRun({ ok: false, error: (err as Error).message });
		} finally {
			setRunning(false);
		}
	};
	return (
		<div data-testid="exercise-sql" className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				<span className="font-medium uppercase tracking-wide">Database</span>
				{schema.map((t) => (
					<span key={t.table} className="font-mono">
						<span className="text-foreground">{t.table}</span>({t.columns.join(", ")}) · {t.rows} rows
					</span>
				))}
				<button type="button" onClick={() => setShowSetup((v) => !v)} className="underline-offset-2 hover:underline">
					{showSetup ? "hide setup" : "show setup"}
				</button>
			</div>
			{showSetup && <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">{input.setupSql}</pre>}
			<CodeEditor language="sql" value={query} onChange={onChange} onRun={() => void execute()} ariaLabel="Your SQL query" testId="exercise-sql-editor" />
			<div className="flex items-center gap-2">
				<button
					type="button"
					data-testid="exercise-sql-run"
					disabled={running || !query.trim()}
					onClick={() => void execute()}
					className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
				>
					{running ? "Running…" : "Run ▸"}
				</button>
				<span className="text-xs text-muted-foreground">Ctrl+Enter · runs on a fresh copy of the database each time</span>
			</div>
			{run && (run.ok ? (
				<div>
					<ResultTable columns={run.columns} rows={run.rows.slice(0, MAX_SHOWN_ROWS)} testId="exercise-sql-result" />
					<div className="mt-1 text-xs text-muted-foreground">{run.rows.length} row{run.rows.length === 1 ? "" : "s"}{run.truncated || run.rows.length > MAX_SHOWN_ROWS ? " (showing the first 50)" : ""}</div>
				</div>
			) : (
				<div data-testid="exercise-sql-error" className="rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-500">{run.error}</div>
			))}
		</div>
	);
}

// ─── html ───────────────────────────────────────────────────────────────────

export function LivePreview({ code, minHeight = 120 }: { code: string; minHeight?: number }) {
	const ref = useRef<HTMLIFrameElement>(null);
	const [state, setState] = useState<DemoBridgeState>(INITIAL_DEMO_BRIDGE_STATE);
	const [doc, setDoc] = useState(() => buildDemoSrcDoc(htmlPreviewDocument(code || " ")));
	useEffect(() => {
		const t = setTimeout(() => setDoc(buildDemoSrcDoc(htmlPreviewDocument(code || " "))), 250);
		return () => clearTimeout(t);
	}, [code]);
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (ref.current && e.source === ref.current.contentWindow) setState((s) => reduceDemoBridgeState(s, e.data));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);
	return (
		<iframe
			ref={ref}
			title="Live preview"
			sandbox="allow-scripts"
			srcDoc={doc}
			scrolling="no"
			data-testid="exercise-html-preview"
			className="w-full rounded-lg border bg-white"
			style={{ height: Math.max(minHeight, state.height ?? minHeight), boxSizing: "content-box" }}
		/>
	);
}

function HtmlField({ code, onChange }: { code: string; onChange: (c: string) => void }) {
	return (
		<div data-testid="exercise-html" className="grid gap-2 lg:grid-cols-2">
			<CodeEditor language="html" value={code} onChange={onChange} ariaLabel="Your HTML" minHeight={160} testId="exercise-html-editor" />
			<div>
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Live preview</div>
				<LivePreview code={code} />
			</div>
		</div>
	);
}

// ─── the answered view (AnsweredCard's exercise body) ───────────────────────

function Mark({ ok }: { ok: boolean }) {
	return ok ? <CheckIcon className="size-3.5 shrink-0 text-green-500" aria-label="right" /> : <XIcon className="size-3.5 shrink-0 text-red-500" aria-label="wrong" />;
}

/** Fork review fix: after "I don't know" (no response to grade), show the
 *  correct answer itself, the way quiz marks its correct options. */
export function ExerciseSolution({ input }: { input: ExerciseToolInput }) {
	return (
		<div data-testid="exercise-solution" className="mt-2 text-sm">
			<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">The answer</div>
			{input.format === "blanks" && (
				<div className={cn("rounded-lg border bg-muted/40 px-3 py-2 whitespace-pre-wrap", input.language ? MONO : "leading-7")}>
					{templateSegments(input.template ?? "").map((seg, i) =>
						"text" in seg ? <span key={i}>{seg.text}</span> : <span key={i} className="rounded bg-green-500/15 px-1 text-green-500">{input.blanks?.[seg.gap]?.accept[0]}</span>,
					)}
				</div>
			)}
			{input.format === "order" && (
				<ol className="flex flex-col gap-1">
					{(input.steps ?? []).map((s, i) => (
						<li key={i} className={cn("whitespace-pre-wrap text-green-500", input.language && MONO)}>{i + 1}. {s}</li>
					))}
				</ol>
			)}
			{input.format === "find-mistake" && (
				<div className="overflow-x-auto rounded-lg border bg-muted/40 py-1">
					{(input.lines ?? []).map((text, i) => (
						<div key={i} className={cn("flex items-start gap-3 px-3", input.mistakeLine === i + 1 && "bg-green-500/10")}>
							<span className={cn("w-6 shrink-0 text-right text-muted-foreground", MONO)}>{i + 1}</span>
							<span className={cn("min-w-0 flex-1 whitespace-pre-wrap", input.language ? MONO : "py-0.5")}>{text}</span>
							{input.mistakeLine === i + 1 && <span className="shrink-0 text-xs text-green-500">the mistake</span>}
						</div>
					))}
				</div>
			)}
			{input.format === "sql" && (
				<pre className="overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-green-500">{input.referenceSql}</pre>
			)}
			{input.format === "math" && <ToolContentResponse>{`$${input.answerLatex}$`}</ToolContentResponse>}
			{input.format === "match" && (
				<ul className="flex flex-col gap-1">
					{(input.pairs ?? []).map((p, i) => (
						<li key={i} className="flex items-start gap-2">
							<span className={cn(input.language && MONO)}>{p.left}</span>
							<span className="text-muted-foreground">→</span>
							<span className="text-green-500">{p.right}</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function ExerciseAnsweredBody({ input, answer }: { input: ExerciseToolInput; answer: ExerciseAnswer }) {
	const { response, result } = answer;
	return (
		<div data-testid="exercise-answered" data-format={input.format} className="mt-2 text-sm">
			{input.format === "blanks" && response.format === "blanks" && (
				<div className={cn("rounded-lg border bg-muted/40 px-3 py-2 whitespace-pre-wrap", input.language ? MONO : "leading-7")}>
					{templateSegments(input.template ?? "").map((seg, i) =>
						"text" in seg ? (
							<span key={i}>{seg.text}</span>
						) : (
							<span key={i} className={cn("rounded px-1", result.items[seg.gap] ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500")}>
								{response.values[seg.gap] || "—"}
								{!result.items[seg.gap] && <span className="ml-1 text-green-500">→ {input.blanks?.[seg.gap]?.accept[0]}</span>}
							</span>
						),
					)}
				</div>
			)}
			{input.format === "order" && response.format === "order" && (
				<div className="grid gap-3 sm:grid-cols-2">
					<ol className="flex flex-col gap-1">
						<li className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your order</li>
						{response.order.map((stepIdx, pos) => (
							<li key={pos} className="flex items-start gap-2">
								<Mark ok={result.items[pos] === true} />
								<span className={cn("whitespace-pre-wrap", input.language && MONO)}>{input.steps?.[stepIdx]}</span>
							</li>
						))}
					</ol>
					{!result.correct && (
						<ol className="flex flex-col gap-1">
							<li className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Correct order</li>
							{(input.steps ?? []).map((s, i) => (
								<li key={i} className={cn("whitespace-pre-wrap text-green-500", input.language && MONO)}>
									{i + 1}. {s}
								</li>
							))}
						</ol>
					)}
				</div>
			)}
			{input.format === "find-mistake" && response.format === "find-mistake" && (
				<div className="overflow-x-auto rounded-lg border bg-muted/40 py-1">
					{(input.lines ?? []).map((text, i) => {
						const chosen = response.line === i + 1;
						const wrong = input.mistakeLine === i + 1;
						return (
							<div key={i} className={cn("flex items-start gap-3 px-3", wrong && "bg-green-500/10", chosen && !wrong && "bg-red-500/10")}>
								<span className={cn("w-6 shrink-0 text-right text-muted-foreground", MONO)}>{i + 1}</span>
								<span className={cn("min-w-0 flex-1 whitespace-pre-wrap", input.language ? MONO : "py-0.5")}>{text}</span>
								{chosen && <span className="shrink-0 text-xs text-muted-foreground">your pick</span>}
								{wrong && <span className="shrink-0 text-xs text-green-500">the mistake</span>}
							</div>
						);
					})}
				</div>
			)}
			{input.format === "match" && response.format === "match" && (
				<ul className="flex flex-col gap-1">
					{(input.pairs ?? []).map((p, i) => {
						const chose = response.picks[i]! >= 0 ? input.pairs?.[response.picks[i]!]?.right : undefined;
						return (
							<li key={i} className="flex items-start gap-2">
								<Mark ok={result.items[i] === true} />
								<span className={cn(input.language && MONO)}>{p.left}</span>
								<span className="text-muted-foreground">→</span>
								<span className={cn(result.items[i] ? "" : "text-red-500 line-through")}>{chose ?? "—"}</span>
								{!result.items[i] && <span className="text-green-500">{p.right}</span>}
							</li>
						);
					})}
				</ul>
			)}
			{input.format === "sql" && response.format === "sql" && (
				<div className="flex flex-col gap-2">
					<pre className="overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">{response.query}</pre>
					{response.error ? (
						<div className="rounded-lg bg-red-500/10 px-3 py-2 font-mono text-xs text-red-500">{response.error}</div>
					) : (
						<ResultTable columns={response.columns} rows={response.rows} />
					)}
					<div className="flex items-center gap-1.5 text-xs">
						<Mark ok={result.correct} />
						{result.correct ? "Same result as the reference query." : `Not the expected result${response.expectedRows !== undefined ? ` (expected ${response.expectedRows} row${response.expectedRows === 1 ? "" : "s"})` : ""}.`}
					</div>
					{!result.correct && input.referenceSql && (
						<details className="text-xs">
							<summary className="cursor-pointer text-muted-foreground">A correct query</summary>
							<pre className="mt-1 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono whitespace-pre-wrap text-green-500">{input.referenceSql}</pre>
						</details>
					)}
				</div>
			)}
			{input.format === "math" && response.format === "math" && (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						{response.verdict !== "undecided" && <Mark ok={result.correct} />}
						<ToolContentResponse>{`$${response.latex}$`}</ToolContentResponse>
					</div>
					{response.verdict === "undecided" && <div className="text-xs text-muted-foreground">The app couldn't decide — the teacher checks this one.</div>}
					{response.verdict === "different" && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							Answer: <span className="text-green-500"><ToolContentResponse>{`$${input.answerLatex}$`}</ToolContentResponse></span>
						</div>
					)}
				</div>
			)}
			{input.format === "html" && response.format === "html" && (
				<div className="grid gap-2 lg:grid-cols-2">
					<pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">{response.code}</pre>
					<LivePreview code={response.code} />
				</div>
			)}
			{result.graded !== false && input.format !== "sql" && input.format !== "math" && (
				<div className="mt-1 text-xs text-muted-foreground">
					{Math.round(result.score * 100)}% right ({result.items.filter(Boolean).length}/{result.items.length})
				</div>
			)}
			{result.graded === false && <div className="mt-1 text-xs text-muted-foreground">The teacher grades this one in the reply.</div>}
		</div>
	);
}
