"use client";
/**
 * Kartice (fork): one course's deck — Ponavljanje / Sve kartice / Raspored
 * (mockups docs/fork-plans/mockups/kartice-review-v1.png, -list-v1.png).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, EllipsisIcon, PlusIcon, SearchIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { Toggle } from "@/components/settings/controls";
import { cn } from "@/lib/utils";
import { formatInterval, toSerbianLatin, type Card, type CardRating } from "@/src/core";
import { ReviewCard, type ReviewOutcome } from "./review-card";
import { ForecastChart, ForecastSummary } from "./forecast";
import { NewCardsDialog } from "./new-cards";
import { useCourseCards, type CourseCardsView } from "./use-cards";

export type DeckTab = "review" | "all" | "schedule";
const TABS: Array<[DeckTab, string]> = [
	["review", "Ponavljanje"],
	["all", "Sve kartice"],
	["schedule", "Raspored"],
];

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "avg", "sep", "okt", "nov", "dec"];
export const examLabel = (date: string) => {
	const [, m, d] = date.split("-").map(Number) as [number, number, number];
	return `${d} ${MONTHS[m - 1]}`;
};

/** The course name for the header: the session title without the "Želim da me …" lead-in is not knowable, so keep it short. */
export function courseName(title: string) {
	const t = toSerbianLatin(title);
	return t.length > 48 ? `${t.slice(0, 46)}…` : t;
}

export function DeckView({ chatId, initialTab }: { chatId: string; initialTab: DeckTab }) {
	const { view, error, review, setFlags, setEnabled } = useCourseCards(chatId);
	const [tab, setTab] = useState<DeckTab>(initialTab);
	const [newOpen, setNewOpen] = useState(false);

	if (error && !view) return <Shell title="Kartice">{<p className="p-8 text-sm text-muted-foreground">Kartice ne mogu da se učitaju ({error}).</p>}</Shell>;
	if (!view) return <Shell title="Kartice">{null}</Shell>;

	const off = !view.globalEnabled || !view.enabled;
	return (
		<Shell
			title={`Kartice · ${courseName(view.title)}`}
			chips={
				<span className="flex shrink-0 items-center gap-2 rounded-full border border-border/80 px-3 py-1 font-ui text-xs uppercase tracking-wide text-muted-foreground" data-testid="deck-chips">
					Danas <b className="font-medium text-amber-400">{view.queue.dueCount}</b>
					<span aria-hidden>·</span> Nove <b className="font-medium text-amber-400">{view.queue.newCount}</b>
					{view.examDate && (
						<>
							<span aria-hidden>·</span> Ispit <b className="font-medium text-amber-400">{examLabel(view.examDate)}</b>
						</>
					)}
				</span>
			}
		>
			<div className="mx-auto w-full max-w-7xl px-8">
				<div className="flex items-center gap-8 border-b border-border">
					{TABS.map(([id, label]) => (
						<button
							key={id}
							type="button"
							data-testid={`tab-${id}`}
							onClick={() => setTab(id)}
							className={cn(
								"-mb-px cursor-pointer border-b-2 px-2 py-3.5 font-ui text-[15px] uppercase tracking-wider transition-colors",
								tab === id ? "border-green-500! text-foreground" : "border-transparent! text-muted-foreground hover:text-foreground",
							)}
						>
							{label}
						</button>
					))}
					<span className="ml-auto flex items-center gap-2 font-ui text-xs uppercase tracking-wider text-muted-foreground">
						<Toggle checked={view.enabled} label="kartice za ovaj kurs" onChange={(on) => void setEnabled(on)} />
						{view.enabled ? "Uključeno" : "Isključeno"}
					</span>
				</div>

				{off && (
					<p className="mt-6 rounded-md border border-border px-4 py-3 text-sm text-muted-foreground" data-testid="deck-off">
						{!view.globalEnabled ? "Kartice su isključene u podešavanjima (Settings → General)." : "Kartice su isključene za ovaj kurs."} Ponavljanje ne prikazuje ništa dok ih ne uključiš.
					</p>
				)}

				{tab === "review" && !off && <ReviewTab view={view} onReview={review} onShowAll={() => setTab("all")} />}
				{tab === "all" && <AllTab view={view} onFlags={setFlags} onNew={() => setNewOpen(true)} />}
				{tab === "schedule" && <ScheduleTab view={view} />}
			</div>
			{newOpen && <NewCardsDialog chatId={chatId} view={view} onClose={() => setNewOpen(false)} />}
		</Shell>
	);
}

function Shell({ title, chips, children }: { title: string; chips?: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className="flex h-dvh min-w-0 flex-1 flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight" data-testid="deck-title">
					{title}
				</h1>
				{chips}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto pb-16 font-prose">{children}</div>
		</div>
	);
}

// ─── Ponavljanje ───────────────────────────────────────────────────────────

function ReviewTab({ view, onReview, onShowAll }: { view: CourseCardsView; onReview: (id: string, r: CardRating, correct?: boolean) => Promise<CourseCardsView | null>; onShowAll: () => void }) {
	const [busy, setBusy] = useState(false);
	const done = useRef(0);
	const [doneCount, setDoneCount] = useState(0);
	const byId = useMemo(() => new Map(view.cards.map((c) => [c.id, c])), [view.cards]);
	// The open card stays put until it is rated: a refresh (timer, push) that
	// reorders the queue must never swap the card mid-answer.
	const [heldId, setHeldId] = useState<string | undefined>(undefined);
	const held = heldId !== undefined && view.queue.ids.includes(heldId) ? heldId : undefined;
	const currentId = held ?? view.queue.ids[0];
	useEffect(() => {
		if (currentId !== heldId) setHeldId(currentId);
	}, [currentId, heldId]);
	const card = currentId ? byId.get(currentId) : undefined;
	const total = doneCount + view.queue.ids.length;

	const rate = useCallback(
		async (rating: CardRating, outcome: ReviewOutcome) => {
			if (!card || busy) return;
			setBusy(true);
			const next = await onReview(card.id, rating, outcome.correct);
			if (next) {
				done.current++;
				setDoneCount(done.current);
				// Next card: the head of the new queue, not the one just rated.
				setHeldId(next.queue.ids.find((id) => id !== card.id) ?? next.queue.ids[0]);
			}
			setBusy(false);
		},
		[card, busy, onReview],
	);

	if (!card) {
		const tomorrow = view.forecast.days[1] ?? 0;
		return (
			<div className="mx-auto mt-16 max-w-xl text-center" data-testid="review-done">
				<p className="font-title text-3xl">{doneCount > 0 ? "Gotovo za danas" : "Nema kartica za sada"}</p>
				<p className="mt-3 text-sm text-muted-foreground">
					{doneCount > 0 && `Ponovio si ${doneCount} ${doneCount === 1 ? "karticu" : "kartica"}. `}
					{view.queue.nextDue ? `Sledeća kartica: za ${formatInterval(view.queue.nextDue - Date.now())}. ` : ""}
					Sutra: {tomorrow}.
				</p>
				<button type="button" onClick={onShowAll} className="mt-6 cursor-pointer font-ui text-xs uppercase tracking-wider text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
					Sve kartice
				</button>
			</div>
		);
	}

	return (
		<div className="mx-auto mt-8 max-w-5xl">
			<div className="mb-4 flex items-center gap-4 font-ui text-xs text-muted-foreground" data-testid="review-progress">
				<span>
					{doneCount + 1} / {total}
				</span>
				<span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
					<span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }} />
				</span>
			</div>
			<ReviewCard key={`${card.id}:${card.reps}`} card={card} previews={view.previews[card.id]} onRate={(r, o) => void rate(r, o)} busy={busy} />
			<p className="mt-3 text-center font-ui text-[11px] text-muted-foreground/70">Tasteri 1–4 biraju ocenu · razmak ili Enter prihvata predlog</p>
		</div>
	);
}

// ─── Sve kartice ───────────────────────────────────────────────────────────

type Filter = "all" | "due" | "new" | "paused";

function nextLabel(c: Card, now: number): { text: string; today: boolean } {
	if (c.status === "suspended") return { text: "—", today: false };
	if (c.status === "known") return { text: "već znam", today: false };
	if (c.due === null) return { text: "nova", today: false };
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const days = Math.floor((c.due - start.getTime()) / 86_400_000);
	if (days <= 0) return { text: "danas", today: true };
	if (days === 1) return { text: "sutra", today: false };
	return { text: `za ${days} dana`, today: false };
}

function AllTab({ view, onFlags, onNew }: { view: CourseCardsView; onFlags: (id: string, f: { suspended?: boolean; known?: boolean; deleted?: boolean }) => Promise<unknown>; onNew: () => void }) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [node, setNode] = useState("");
	const now = Date.now();
	const queued = new Set(view.queue.ids);
	const nodes = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of view.cards) m.set(c.nodeId, toSerbianLatin(c.nodeTitle ?? c.nodeId));
		return [...m.entries()];
	}, [view.cards]);
	const counts = {
		all: view.cards.length,
		due: view.cards.filter((c) => queued.has(c.id) && c.status !== "new").length,
		new: view.cards.filter((c) => c.status === "new").length,
		paused: view.cards.filter((c) => c.status === "suspended" || c.status === "known").length,
	};
	const q = query.trim().toLowerCase();
	const rows = view.cards.filter((c) => {
		if (filter === "due" && !(queued.has(c.id) && c.status !== "new")) return false;
		if (filter === "new" && c.status !== "new") return false;
		if (filter === "paused" && c.status !== "suspended" && c.status !== "known") return false;
		if (node && c.nodeId !== node) return false;
		if (q && !toSerbianLatin(c.question).toLowerCase().includes(q)) return false;
		return true;
	});
	const pills: Array<[Filter, string]> = [
		["all", "Sve"],
		["due", "Dospele"],
		["new", "Nove"],
		["paused", "Pauzirane"],
	];
	return (
		<div className="mt-6">
			<div className="flex flex-wrap items-center gap-3">
				<label className="relative min-w-56 flex-1">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Pretraži pitanja…"
						data-testid="cards-search"
						className="h-10 w-full rounded-md border border-border bg-background pr-3 pl-9 text-lg outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40!"
					/>
				</label>
				{pills.map(([id, label]) => (
					<button
						key={id}
						type="button"
						data-testid={`filter-${id}`}
						onClick={() => setFilter(id)}
						className={cn(
							"h-10 cursor-pointer rounded-md border px-3 font-ui text-sm uppercase tracking-wider",
							filter === id ? "border-green-500! text-green-400" : "border-border text-muted-foreground hover:text-foreground",
						)}
					>
						{label} <b className={cn("ml-1 font-medium", id === "due" || id === "new" ? "text-amber-400" : "")}>{counts[id]}</b>
					</button>
				))}
				<span className="relative">
					<select
						value={node}
						onChange={(e) => setNode(e.target.value)}
						aria-label="Korak"
						className="h-10 cursor-pointer appearance-none rounded-md border border-border bg-background pr-8 pl-3 text-lg text-foreground outline-none"
					>
						<option value="">Korak: svi</option>
						{nodes.map(([id, title]) => (
							<option key={id} value={id}>
								{title}
							</option>
						))}
					</select>
					<ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground" />
				</span>
				<button
					type="button"
					data-testid="new-cards"
					onClick={onNew}
					className="ml-auto flex h-10 cursor-pointer items-center gap-1.5 rounded-md border border-foreground/60! px-3 font-ui text-sm uppercase tracking-wider text-foreground hover:bg-accent"
				>
					<PlusIcon className="size-3.5" /> Nova pitanja
				</button>
			</div>

			<div className="mt-4 rounded-lg border border-border">
				<table className="w-full table-fixed text-lg" data-testid="cards-table">
					<thead>
						<tr className="border-b border-border font-ui text-xs uppercase tracking-wider text-muted-foreground">
							<th className="px-4 py-3 text-left font-normal">Pitanje</th>
							<th className="w-64 px-4 py-3 text-left font-normal">Korak</th>
							<th className="w-32 px-4 py-3 text-left font-normal">Sledeće</th>
							<th className="w-32 px-4 py-3 text-center font-normal">Ponavljanja</th>
							<th className="w-28 px-4 py-3 text-center font-normal">Promašaji</th>
							<th className="w-12" />
						</tr>
					</thead>
					<tbody>
						{rows.map((c) => {
							const next = nextLabel(c, now);
							const paused = c.status === "suspended" || c.status === "known";
							return (
								<tr key={c.id} className="border-b border-border/60 last:border-b-0" data-testid="card-row">
									<td className={cn("px-4 py-3", paused && "text-muted-foreground")}>
										<span className="flex min-w-0 items-center gap-2" title={plainQuestion(c.question)}>
											<span className="min-w-0 truncate">{plainQuestion(c.question)}</span>
											{c.status === "suspended" && <Tag>Pauzirana</Tag>}
											{c.source === "generated" && <Tag>Nova AI</Tag>}
										</span>
									</td>
									<td className={cn("truncate px-4 py-3 whitespace-nowrap", paused ? "text-muted-foreground" : "text-foreground/85")}>{toSerbianLatin(c.nodeTitle ?? c.nodeId)}</td>
									<td className="px-4 py-3 whitespace-nowrap">
										{next.today ? <span className="rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">{next.text}</span> : <span className="text-muted-foreground">{next.text}</span>}
									</td>
									<td className="px-4 py-3 text-center">{c.reps}</td>
									<td className="px-4 py-3 text-center">{c.lapses}</td>
									<td className="px-2 py-2.5 text-right">
										<RowMenu card={c} onFlags={onFlags} />
									</td>
								</tr>
							);
						})}
						{rows.length === 0 && (
							<tr>
								<td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
									Nema kartica za ovaj filter.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** One line of the question, markdown and math markers dropped. */
function plainQuestion(q: string) {
	return toSerbianLatin(q)
		.replace(/```[\s\S]*?```/g, " [kôd] ")
		.replace(/[`*_#>$]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function Tag({ children }: { children: React.ReactNode }) {
	return <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-ui text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>;
}

function RowMenu({ card, onFlags }: { card: Card; onFlags: (id: string, f: { suspended?: boolean; known?: boolean; deleted?: boolean }) => Promise<unknown> }) {
	const [open, setOpen] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const act = (f: { suspended?: boolean; known?: boolean; deleted?: boolean }) => {
		setOpen(false);
		setConfirmDelete(false);
		void onFlags(card.id, f);
	};
	const paused = card.status === "suspended";
	const known = card.status === "known";
	const menuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent | KeyboardEvent) => {
			if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.parentElement?.contains(e.target as Node)) {
				setOpen(false);
				setConfirmDelete(false);
			}
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", close);
		};
	}, [open]);
	return (
		<span className="relative inline-block">
			<button type="button" aria-label="Opcije kartice" onClick={() => setOpen((o) => !o)} className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
				<EllipsisIcon className="size-4" />
			</button>
			{open && (
				<div ref={menuRef} role="menu" className="absolute top-full right-0 z-20 mt-1 w-48 rounded-md border border-border bg-popover p-1 shadow-lg">
					<MenuItem onClick={() => act({ suspended: !paused })}>{paused ? "Nastavi" : "Pauziraj"}</MenuItem>
					<MenuItem onClick={() => act({ known: !known })}>{known ? "Vrati u ponavljanje" : "Već znam"}</MenuItem>
					{confirmDelete ? (
						<MenuItem danger onClick={() => act({ deleted: true })}>Sigurno obriši?</MenuItem>
					) : (
						<MenuItem danger onClick={() => setConfirmDelete(true)}>Obriši</MenuItem>
					)}
				</div>
			)}
		</span>
	);
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
	return (
		<button type="button" onClick={onClick} className={cn("block w-full cursor-pointer rounded px-3 py-1.5 text-left text-sm hover:bg-accent", danger ? "text-red-400" : "text-foreground")}>
			{children}
		</button>
	);
}

// ─── Raspored ──────────────────────────────────────────────────────────────

function ScheduleTab({ view }: { view: CourseCardsView }) {
	return (
		<div className="mt-8">
			<p className="mb-3 font-ui text-xs uppercase tracking-widest text-muted-foreground">Raspored · sledećih 14 dana</p>
			<ForecastChart days={view.forecast.days} now={view.now} />
			<ForecastSummary days={view.forecast.days} untilExam={view.forecast.untilExam} />
			<p className="mt-6 border-t border-border pt-4 font-ui text-xs uppercase tracking-widest text-muted-foreground">
				Nove kartice dnevno: {view.settings.newPerDay} · Cilj pamćenja: {Math.round(view.settings.retention * 100)}% ·{" "}
				<Link href="/cards" className="underline-offset-4 hover:text-foreground hover:underline">
					podešavanja
				</Link>
			</p>
		</div>
	);
}
