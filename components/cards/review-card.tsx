"use client";
/**
 * Kartice (fork): one card under review — answer, the app's check where it
 * can make one, the correct answer, then the four ratings (mockup
 * docs/fork-plans/mockups/kartice-review-v1.png).
 */
import { useEffect, useMemo, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { MarkdownInsideControl } from "@/components/md-blocks";
import { ExerciseForm } from "@/components/exercise-form";
import { cn } from "@/lib/utils";
import {
	formatInterval,
	isCorrect,
	normalizeOptions,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	suggestedRating,
	toSerbianLatin,
	type Card,
	type CardRating,
	type ExerciseToolInput,
	type QuestionAnswerData,
} from "@/src/core";

const RATING_LABELS: Record<CardRating, string> = { 1: "Ponovo", 2: "Teško", 3: "Dobro", 4: "Lako" };
const LETTERS = "ABCDEFGHIJKLMNOP";

const lat = (v: unknown) => (typeof v === "string" ? toSerbianLatin(v) : "");
/** Short questions read big (mockup); long ones shrink so the answers and ratings stay in view. */
const questionScale = (q: string) => (q.length <= 90 ? 2 : q.length <= 200 ? 1.6 : 1.35);

/** Markdown at a multiple of the learner's prose size (Settings → Appearance). */
function Prose({ children, className, scale = 1 }: { children: string; className?: string; scale?: number }) {
	const vars = { "--lh-card-scale": String(scale), ...(scale > 1.3 ? { "--lh-card-leading": "1.3" } : {}) } as React.CSSProperties;
	return (
		<div className="lh-card-prose" style={vars}>
			<ToolContentResponse className={cn("lh-prose block", className)}>{children}</ToolContentResponse>
		</div>
	);
}

export interface ReviewOutcome {
	correct?: boolean;
}

export function ReviewCard({
	card,
	previews,
	onRate,
	busy,
	notesHref,
}: {
	card: Card;
	/** The step's section in the course notes. */
	notesHref?: string;
	/** When each rating brings the card back (ms). */
	previews: Record<CardRating, number> | undefined;
	onRate: (rating: CardRating, outcome: ReviewOutcome) => void;
	busy: boolean;
}) {
	const [revealed, setRevealed] = useState(false);
	const [outcome, setOutcome] = useState<ReviewOutcome>({});
	const suggested = revealed ? suggestedRating(outcome.correct) : null;

	// 1-4 rate once revealed (Anki's keys).
	useEffect(() => {
		if (!revealed) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
			const n = Number(e.key);
			if (n >= 1 && n <= 4 && !busy) {
				e.preventDefault();
				onRate(n as CardRating, outcome);
			} else if ((e.key === " " || e.key === "Enter") && suggested && !busy) {
				e.preventDefault();
				onRate(suggested, outcome);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [revealed, busy, onRate, outcome, suggested]);

	const reveal = (o: ReviewOutcome) => {
		setOutcome(o);
		setRevealed(true);
		// The answer field keeps focus otherwise, and 1-4 would type nothing.
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	};

	return (
		<div data-testid="review-card" className="rounded-lg border border-border bg-card/40">
			<div className="flex items-center justify-between border-b border-border px-6 py-3 font-ui text-xs uppercase tracking-widest text-muted-foreground">
				<span>
					Korak ·{" "}
					{notesHref ? (
						<a href={notesHref} title="Beleške za ovaj korak" className="underline-offset-4 hover:text-foreground hover:underline">
							{lat(card.nodeTitle ?? card.nodeId)}
						</a>
					) : (
						lat(card.nodeTitle ?? card.nodeId)
					)}
				</span>
				<span>{card.status === "new" ? "Nova" : card.tool === "explain" ? "Slobodan odgovor" : card.tool === "exercise" ? "Vežba" : "Check"}</span>
			</div>
			<div className="px-6 py-5">
				{card.tool === "quiz" && <QuizBody card={card} revealed={revealed} onReveal={reveal} />}
				{card.tool === "explain" && <ExplainBody card={card} revealed={revealed} onReveal={reveal} />}
				{card.tool === "exercise" && <ExerciseBody card={card} revealed={revealed} onReveal={reveal} />}

				{revealed && (
					<div className="mt-6 grid grid-cols-4 gap-3" data-testid="rating-row">
						{([1, 2, 3, 4] as CardRating[]).map((g) => {
							const when = previews?.[g];
							return (
								<button
									key={g}
									type="button"
									disabled={busy}
									data-testid={`rate-${g}`}
									onClick={() => onRate(g, outcome)}
									className={cn(
										"flex min-h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-3 py-3 transition-colors disabled:cursor-wait disabled:opacity-60",
										g === 1 ? "border-error/70! hover:bg-error/10" : "border-border hover:bg-accent",
										suggested === g && (g === 1 ? "bg-error/10" : "border-success! bg-success/15"),
									)}
								>
									<span className="flex items-center gap-2 text-xl font-medium text-foreground">
										{RATING_LABELS[g]}
										{suggested === g && (
											<span className={cn("rounded px-1.5 py-0.5 font-ui text-xs uppercase tracking-wider", g === 1 ? "bg-error/15 text-error" : "bg-success/20 text-success")}>
												Predlog
											</span>
										)}
									</span>
									<span className="font-ui text-base text-muted-foreground">
										{when !== undefined ? `${when - Date.now() < 10 * 60_000 ? "< " : ""}${formatInterval(Math.max(60_000, when - Date.now()))}` : ""}
									</span>
									<span className="sr-only">taster {g}</span>
								</button>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function AnswerBlock({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="mt-5 border-t border-border pt-4">
			<p className="mb-1.5 font-ui text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
			{children}
		</div>
	);
}

function DontKnowButton({ onClick }: { onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="cursor-pointer font-ui text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
			Ne znam
		</button>
	);
}

function QuizBody({ card, revealed, onReveal }: { card: Card; revealed: boolean; onReveal: (o: ReviewOutcome) => void }) {
	const { options, correct, error } = useMemo(() => {
		try {
			// A fresh order each review (seeded, so a re-render keeps it).
			const shuffled = shuffleOptions(normalizeOptions(card.args.options as never), seededRandom(`${card.id}:${card.reps}`));
			const r = resolveCorrect(card.args.correctAnswer as string | string[] | undefined, shuffled);
			return { options: shuffled, correct: r.indices, error: r.error };
		} catch (e) {
			return { options: [], correct: [], error: e instanceof Error ? e.message : String(e) };
		}
	}, [card.id, card.reps, card.args.options, card.args.correctAnswer]);
	const multi = card.args.multiSelect === true || correct.length > 1;
	const [picked, setPicked] = useState<number[]>([]);
	if (error) return <p className="text-sm text-error">Kartica ne može da se prikaže: {error}</p>;
	const toggle = (i: number) => {
		if (revealed) return;
		if (!multi) {
			setPicked([i]);
			onReveal({ correct: isCorrect([i], correct) });
			return;
		}
		setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
	};
	return (
		<>
			<Prose scale={questionScale(card.question)}>{lat(card.question)}</Prose>
			<div className="mt-5 flex flex-col gap-2.5">
				{options.map((o, k) => {
					const i = k + 1;
					const isRight = correct.includes(i);
					const isPicked = picked.includes(i);
					return (
						<button
							key={o.value}
							type="button"
							data-testid={`option-${i}`}
							onClick={() => toggle(i)}
							disabled={revealed}
							className={cn(
								"flex w-full cursor-pointer items-center gap-4 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-default",
								!revealed && (isPicked ? "border-foreground/60! bg-accent" : "border-border hover:bg-accent"),
								revealed && isRight && "border-success! bg-success/15",
								revealed && !isRight && isPicked && "border-error/70! bg-error/10",
								revealed && !isRight && !isPicked && "border-border opacity-60",
							)}
						>
							<span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted font-ui text-xs text-muted-foreground">{LETTERS[k]}</span>
							<span className="min-w-0 flex-1">
								<MarkdownInsideControl>
									<Prose scale={1.25}>{lat(o.label)}</Prose>
								</MarkdownInsideControl>
							</span>
							{revealed && isRight && (
								<span className="flex items-center gap-1.5 font-ui text-xs uppercase tracking-wider text-success">
									<CheckIcon className="size-4" /> Tačno
								</span>
							)}
							{revealed && !isRight && isPicked && <XIcon className="size-4 text-error" />}
						</button>
					);
				})}
			</div>
			{!revealed && (
				<div className="mt-4 flex items-center justify-between">
					<DontKnowButton onClick={() => onReveal({ correct: false })} />
					{multi && (
						<button
							type="button"
							disabled={picked.length === 0}
							onClick={() => onReveal({ correct: isCorrect(picked, correct) })}
							className="cursor-pointer rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
						>
							Proveri
						</button>
					)}
				</div>
			)}
			{revealed && typeof card.args.explanation === "string" && card.args.explanation.trim() && (
				<AnswerBlock label="Objašnjenje">
					<Prose scale={1.3}>{lat(card.args.explanation)}</Prose>
				</AnswerBlock>
			)}
		</>
	);
}

function ExplainBody({ card, revealed, onReveal }: { card: Card; revealed: boolean; onReveal: (o: ReviewOutcome) => void }) {
	const [text, setText] = useState("");
	return (
		<>
			<Prose scale={questionScale(card.question)}>{lat(card.question)}</Prose>
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				readOnly={revealed}
				placeholder="Tvoj odgovor (nije obavezno, pomaže da uporediš)…"
				rows={4}
				data-testid="explain-answer"
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !revealed) {
						e.preventDefault();
						onReveal({});
					}
				}}
				className="mt-5 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40!"
			/>
			{!revealed ? (
				<div className="mt-3 flex items-center justify-between">
					<DontKnowButton onClick={() => onReveal({ correct: false })} />
					<button
						type="button"
						data-testid="show-answer"
						onClick={() => onReveal({})}
						className="cursor-pointer rounded-md border border-border px-3 py-1.5 font-ui text-xs uppercase tracking-wider text-foreground hover:bg-accent"
					>
						Prikaži odgovor
					</button>
				</div>
			) : (
				<AnswerBlock label="Tačan odgovor">
					<Prose scale={1.3}>{lat(card.args.correctAnswer)}</Prose>
					<p className="mt-3 font-ui text-xs text-muted-foreground">Uporedi sa svojim odgovorom i izaberi ocenu.</p>
				</AnswerBlock>
			)}
		</>
	);
}

function ExerciseBody({ card, revealed, onReveal }: { card: Card; revealed: boolean; onReveal: (o: ReviewOutcome) => void }) {
	const [result, setResult] = useState<QuestionAnswerData | null>(null);
	const graded = result?.exercise?.result && result.exercise.result.graded !== false;
	return (
		<>
			{!revealed ? (
				<ExerciseForm
					// A fresh draft per review, never the chat's.
					toolCallId={`card:${card.id}:${card.reps}`}
					input={card.args as unknown as ExerciseToolInput}
					dictationClaim={false}
					onSubmit={(answer) => {
						setResult(answer);
						const r = answer.exercise?.result;
						onReveal({ correct: answer.dontKnow ? false : r && r.graded !== false ? r.correct : undefined });
					}}
				/>
			) : (
				<>
					<Prose scale={questionScale(card.question)}>{lat(card.question)}</Prose>
					<AnswerBlock label="Rezultat">
						<p className={cn("text-base", graded ? (result!.exercise!.result!.correct ? "text-success" : "text-error") : "text-muted-foreground")}>
							{result?.dontKnow
								? "Ne znam"
								: graded
									? `${result!.exercise!.result!.correct ? "Tačno" : "Netačno"} · ${Math.round((result!.exercise!.result!.score ?? 0) * 100)}%`
									: "Aplikacija ovo ne može sama da proveri — oceni sam."}
						</p>
					</AnswerBlock>
					{typeof card.args.explanation === "string" && card.args.explanation.trim() && (
						<AnswerBlock label="Objašnjenje">
							<Prose scale={1.3}>{lat(card.args.explanation)}</Prose>
						</AnswerBlock>
					)}
				</>
			)}
		</>
	);
}
