"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ViewReaderRef } from "./session-view-readers";
import { ChevronRightIcon, LightbulbIcon, TimerIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { joinDictation, useDictationTarget } from "@/components/dictation";
import { useEnterSubmits } from "@/components/enter-submits";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { PathInput } from "@/components/path-input";
import { useDictationGhost } from "@/components/dictation-state";
import { PhotoTray, usePhotoAttachments } from "@/components/photo-attach";
import { MathField } from "@/components/math-field";
import { mathEquivalent } from "@/components/math-check";
import type { PrepareThinkingSubmission } from "./plugin-submission-adapters";
import { cn } from "@/lib/utils";

/**
 * The practice dock (practice sessions, owner design 2026-10-04): an
 * ACTIVE problem replaces the chat composer — the persistent bottom blob
 * morphs into the problem. The agent's statement above; the learner's
 * half below — "Your thinking", a labeled field with ONE Send button
 * (owner round 2, 2026-10-05): Enter sends, Shift+Enter makes a newline.
 * There are no lanes — whether a submission claims an answer is apparent
 * from the thinking itself; the agent reads it. One problem may carry
 * many submissions; each starts a turn.
 *
 * Collapse (scroll-up → slim bar) is owned by the DockOverlay; this
 * component is content only, and the expanded form stays MOUNTED while
 * collapsed (hidden) so a half-written trace survives scrolling.
 *
 * The commitment (modelSolution, decisionPoints, …) rides the tool call's
 * arguments and is NOT rendered here — only the statement is the
 * learner's. Esc dismisses the problem (the layered-Esc chain; the
 * confirm dialog then the silent route) — claimed by the page, not here.
 */

export interface PracticeDockProps {
	viewReader?: ViewReaderRef<string>;
	/** The active problem's tool-call id (submissions target it). */
	problemCallId: string;
	/** The pose's arguments — only the statement is the learner's (the
	 *  mode badge would edge toward announcing the target; dropped). */
	input: { statement: string; parts?: Array<{ label: string; statement: string }>; timeLimitMin?: number; finalAnswerLatex?: string };
	/** Fork: when the problem was posed (ms) — the timer's zero. */
	posedAt?: number;
	/** Fork: hints already asked for on this problem (from the record). */
	hintsUsed?: number;
	/** Collapse state, owned by the DockOverlay. */
	expanded: boolean;
	onExpand: () => void;
	/** text — POST {type:"thinking"} (one lane; the register is read from the text).
	 *  Fork: `photos` = snapshot ids of attached photos of handwritten work. */
	onSubmit: (text: string, photos?: string[]) => void;
	onPrepareSubmission?: PrepareThinkingSubmission;
	/** Host-owned alternative editor. The native statement/thinking/controls stay shared. */
	customInput?: {
		editor: ReactNode;
		thinking: string;
		onThinkingChange(value: string): void;
		ready: boolean;
		prepare: PrepareThinkingSubmission;
	};
	hasPendingInput?: boolean;
	preparing?: boolean;
	/** Escape in the thinking field stops dictation (threaded from the page). */
	onEscape?: () => void;
	/** Compaction is running for this chat (owner round 14): the thinking
	 *  POST would block on the server's compaction gate — disable submit
	 *  and say so in the hint row. The server registry is the real gate;
	 *  this is the affordance. */
	compactionRunning?: boolean;
}

/** Fork: the hint request's fixed wording (the record counts hints by it). */
export const HINT_REQUEST_PREFIX = "Hint please";

export function hintRequestText(n: number): string {
	return `${HINT_REQUEST_PREFIX} — give me the next hint (hint #${n}), just one step.`;
}

/** Fork: what a native practice submission says to the teacher — the part
 *  and elapsed-time tags, the learner's text (or a photo placeholder), and
 *  the app's check of the final answer. */
export function composePracticeText({ text, final, verdict, part, elapsedMs, photoCount }: {
	text: string;
	final?: string;
	verdict?: "equal" | "different" | "undecided";
	part?: string;
	elapsedMs: number;
	photoCount: number;
}): string {
	const tags = [part ? `(${part})` : "", `[elapsed ${formatClock(elapsedMs)}]`].filter(Boolean).join(" ");
	const finalLine = final && verdict
		? `\nFinal answer: $${final}$ — app check: ${verdict === "equal" ? "EQUAL to the committed answer" : verdict === "different" ? "DIFFERENT from the committed answer" : "could not decide (judge it yourself)"}`
		: "";
	return `${tags}\n${text || (photoCount ? "(photo of my work)" : "")}${finalLine}`;
}

/** "12:05" from milliseconds. */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function PracticeDock({ viewReader, problemCallId, input, posedAt, hintsUsed = 0, expanded, onExpand, onSubmit, onPrepareSubmission, customInput, hasPendingInput = false, preparing = false, onEscape, compactionRunning = false }: PracticeDockProps) {
	const controller = useOptionalInteractionLayers();
	const rootRef = useRef<HTMLElement>(null);
	const [nativeThinking, setNativeThinking] = useState("");
	const custom = useRef(customInput); custom.current = customInput;
	const thinking = customInput ? customInput.thinking : nativeThinking;
	const setThinking = (value: string) => { if (custom.current) custom.current.onThinkingChange(value); else setNativeThinking(value); };
	// Fork: the part being answered, and the timer (teacher limit, or the learner's own).
	const parts = input.parts && input.parts.length > 1 ? input.parts : null;
	const [partIdx, setPartIdx] = useState(0);
	const [timerOn, setTimerOn] = useState(input.timeLimitMin !== undefined);
	const [limitMin, setLimitMin] = useState<number | null>(input.timeLimitMin ?? null);
	const [editingLimit, setEditingLimit] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const startRef = useRef(posedAt ?? Date.now());
	useEffect(() => {
		if (!timerOn) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [timerOn]);
	const elapsed = now - startRef.current;
	const photos = usePhotoAttachments();
	// Fork: the final-answer math field (only when the problem has one).
	const [finalAnswer, setFinalAnswer] = useState("");
	const finalRef = useRef("");
	const submittingRef = useRef(false);
	const remaining = limitMin !== null ? limitMin * 60_000 - elapsed : null;
	// Ref MIRRORS the field ("nothing gets lost", the question-dock
	// discipline): a submit resuming after `await finishDictation()` reads
	// the tail, never a stale closure.
	const thinkingRef = useRef(thinking); thinkingRef.current = thinking;
	const editRevision = useRef(0);
	useLayoutEffect(() => {
		if (!viewReader) return;
		const read = () => thinkingRef.current;
		viewReader.current = read;
		return () => { if (viewReader.current === read) viewReader.current = null; };
	}, [viewReader]);

	const dictationAppend = useCallback(
		(t: string) => {
			const v = joinDictation(thinkingRef.current, t);
			thinkingRef.current = v; editRevision.current++;
			setThinking(v);
		},
		[],
	);
	useDictationTarget(dictationAppend, true);
	// Fork: the live (greyed) dictation words.
	const dictationGhost = useDictationGhost(dictationAppend);

	useLayoutEffect(() => { viewReader?.changed?.(); }, [viewReader, thinking]);
	const submit = async () => {
		if (compactionRunning || preparing || submittingRef.current) return;
		// v0.6.0: a plugin's own editor owns sending (upstream's path, unchanged).
		if (customInput) {
			if (!customInput.ready) return;
			let capturedRevision = editRevision.current;
			customInput.prepare(() => { capturedRevision = editRevision.current; return thinkingRef.current; }, captured => {
				if (editRevision.current === capturedRevision && thinkingRef.current === captured) { thinkingRef.current = ""; setThinking(""); }
			});
			return;
		}
		const text = thinkingRef.current.trim();
		const images = [...photos.ids];
		const final = finalRef.current.trim();
		if (text.length === 0 && images.length === 0 && final.length === 0 && !hasPendingInput) return;
		if (photos.uploading) return;
		submittingRef.current = true;
		try {
			// Fork: the final answer is checked here and the verdict rides along.
			const verdict = final && input.finalAnswerLatex ? await mathEquivalent(input.finalAnswerLatex, final) : undefined;
			const composed = composePracticeText({ text, final, verdict, part: parts ? parts[partIdx]!.label : undefined, elapsedMs: Date.now() - startRef.current, photoCount: images.length });
			// Clear only what was sent — anything typed meanwhile stays.
			const clearSent = () => {
				if (thinkingRef.current.trim() === text) { thinkingRef.current = ""; editRevision.current++; setThinking(""); }
				if (finalRef.current.trim() === final) { finalRef.current = ""; setFinalAnswer(""); }
				for (const id of images) photos.remove(id);
			};
			if (onPrepareSubmission) {
				// v0.6.0's prepared path (plugins may add images to it); the
				// fork's text and photos ride along, cleared once accepted.
				onPrepareSubmission(() => composed, () => clearSent(), images);
			} else {
				clearSent();
				onSubmit(composed, images.length ? images : undefined);
			}
		} finally {
			submittingRef.current = false;
		}
	};
	const askHint = () => {
		if (compactionRunning) return;
		onSubmit(hintRequestText(hintsUsed + 1));
	};

	/* ENTER SUBMITS FROM ANYWHERE (owner round 6, 2026-10-05): dictation
	 * means the field is often never focused — the window-level Enter
	 * (typing surfaces and buttons excluded) submits the trace. Mounted
	 * while the dock is — collapsed bar included (the trace survives). */
	useEnterSubmits(() => void submit(), rootRef);

	/* ── the collapsed bar ── */
	const bar = (
			<button
				ref={element => { if (!customInput) rootRef.current = element; }}
				type="button"
				data-testid="practice-dock-bar"
				onClick={onExpand}
				className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon className="size-4 shrink-0 rotate-90" />
				<span className="font-medium">Problem</span>
				<span className="min-w-0 flex-1 truncate">{input.statement}</span>
			</button>
		);
	if (!expanded && !customInput) return bar;

	/* ── the expanded form ── */
	return (
		<div ref={element => { rootRef.current = element; }} data-testid="practice-dock" data-problem={problemCallId}>
			{!expanded && bar}
			<div hidden={!expanded}>
			{/* The agent's half: the 'Problem' eyebrow (mirroring the quiz
			    cards' label row — owner round, 2026-10-05) + the statement,
			    markdown + LaTeX rendered, capped by the measured column
			    (--dock-max-h; the old fixed 40vh cut long problems short). */}
			<div data-dock-scroll-area="" className="max-h-[var(--dock-max-h,40vh)] overflow-y-auto px-4 pt-3 pb-2">
				<div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problem</div>
				<div className="lh-prose text-[15px]">
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
				{parts && (
					<div data-testid="practice-parts" className="mt-2 flex flex-col gap-1.5">
						{parts.map((p, i) => (
							<button
								key={p.label}
								type="button"
								data-testid={`practice-part-${p.label}`}
								aria-pressed={i === partIdx}
								onClick={() => setPartIdx(i)}
								className={cn(
									"flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
									i === partIdx ? "border-primary bg-accent" : "border-border/60 hover:bg-accent/40",
								)}
							>
								<span className="shrink-0 font-mono text-sm font-medium">({p.label})</span>
								<span className="lh-prose min-w-0 flex-1 text-sm">
									<ToolContentResponse>{p.statement}</ToolContentResponse>
								</span>
							</button>
						))}
					</div>
				)}
			</div>
			{/* Fork: hints + timer row. */}
			<div className="flex flex-wrap items-center gap-2 px-3 pt-1 text-xs text-muted-foreground">
				<button
					type="button"
					data-testid="practice-hint"
					disabled={compactionRunning}
					onClick={askHint}
					className="flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
				>
					<LightbulbIcon className="size-3.5" />
					{hintsUsed === 0 ? "Hint" : `Next hint (${hintsUsed} used)`}
				</button>
				<button
					type="button"
					data-testid="practice-timer-toggle"
					aria-pressed={timerOn}
					onClick={() => setTimerOn((v) => !v)}
					className={cn("flex items-center gap-1 rounded-md border px-2 py-1 transition-colors hover:bg-accent", timerOn ? "border-primary/60 text-foreground" : "border-border/70")}
				>
					<TimerIcon className="size-3.5" />
					{timerOn ? "Timer on" : "Timer"}
				</button>
				{timerOn && (
					<span
						data-testid="practice-clock"
						className={cn(
							"font-mono tabular-nums",
							remaining !== null && remaining <= 60_000 && remaining > 0 && "text-warning",
							remaining !== null && remaining <= 0 && "text-error",
						)}
					>
						{remaining === null ? formatClock(elapsed) : remaining > 0 ? `${formatClock(remaining)} left` : `time's up (+${formatClock(-remaining)})`}
					</span>
				)}
				{timerOn &&
					(editingLimit ? (
						<input
							type="number"
							min={1}
							max={300}
							autoFocus
							data-testid="practice-limit-input"
							defaultValue={limitMin ?? ""}
							placeholder="min"
							onBlur={(e) => {
								const v = Number(e.target.value);
								setLimitMin(Number.isFinite(v) && v >= 1 ? Math.min(300, Math.round(v)) : null);
								setEditingLimit(false);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") (e.target as HTMLInputElement).blur();
							}}
							className="w-14 rounded border border-border bg-transparent px-1 py-0.5"
						/>
					) : (
						<button type="button" data-testid="practice-limit" onClick={() => setEditingLimit(true)} className="underline-offset-2 hover:underline">
							{limitMin === null ? "set a limit" : `limit ${limitMin} min`}
						</button>
					))}
			</div>

			{customInput?.editor}

			{/* The learner's half: Enter SENDS (owner round 2, 2026-10-05);
			    Shift+Enter makes a newline — less to decide about. */}
			<div
				data-testid="practice-thinking-field"
				{...photos.areaProps}
				className="m-1.5 rounded-[10px] border border-border/70 bg-background/60 transition-colors focus-within:border-primary/50"
			>
				<div className="px-2.5 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{parts ? `YOUR THINKING · PART (${parts[partIdx]!.label})` : "YOUR THINKING"}
				</div>
				<PathInput
					value={thinking}
					ghostText={dictationGhost}
					onValueChange={(value) => {
						thinkingRef.current = value; editRevision.current++;
						setThinking(value);
					}}
					onKeyDown={(e) => {
						if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
						// Esc ends dictation — stopPropagation claims it (the
						// keyboard machine) so the window chain doesn't also fire.
						if (e.key === "Escape" && onEscape) {
							controller?.claimEscape(e);
							e.preventDefault();
							e.stopPropagation();
							onEscape();
							return;
						}
						// Enter SENDS — the single lane (owner round 2, 2026-10-05);
						// Shift+Enter is the newline, ⌘/Ctrl+Enter the chord too.
						if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							submit();
						}
					}}
					placeholder="Work here, think out loud — or paste/drag a photo of your written work."
					className={cn(
						"field-sizing-content lh-input max-h-64 min-h-16 w-full resize-none bg-transparent px-2.5 pb-2 outline-none placeholder:text-muted-foreground",
					)}
				/>
				{/* The submit row (owner round 4, 2026-10-05): IDENTICAL to the
				    question dock's — hint left, the SAME Button (h-9, px-3.5),
				    one p-1 row. Corner radii concentric: shell 16 − m-1.5 (6) =
				    field 10 − p-1 (4) = button 6. */}
				{input.finalAnswerLatex && (
					<div className="px-1.5 pb-1" data-testid="practice-final-answer">
						<div className="px-1 pb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Final answer (optional)</div>
						<MathField
							value={finalAnswer}
							onChange={(v) => {
								finalRef.current = v;
								setFinalAnswer(v);
							}}
							onEnter={() => void submit()}
							ariaLabel="Final answer"
							placeholder="Type your final answer"
						/>
					</div>
				)}
				<PhotoTray attach={photos} disabled={compactionRunning} />
				<div className="flex items-center justify-between gap-2 p-1">
					<span aria-hidden className="pl-1.5 text-xs text-muted-foreground">
						{compactionRunning ? "compacting session…" : "↵ submits · ⇧↵ newline"}
					</span>
					<Button
						type="button"
						data-testid="practice-send"
						disabled={(customInput ? !customInput.ready : (thinking.trim().length === 0 && photos.ids.length === 0 && finalAnswer.trim().length === 0 && !hasPendingInput)) || photos.uploading || compactionRunning || preparing}
						onClick={() => submit()}
						className="ml-auto h-9 rounded-[6px] px-3.5 text-sm font-medium"
					>
						{customInput ? "Submit" : "Submit thinking"}
					</Button>
				</div>
			</div>
			</div>
		</div>
	);
}
