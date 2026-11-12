"use client";
/**
 * Fork (problem log): the Arhiva tab — the DMS competition problems (category
 * B, Takmicenja-matematika-B), READ-ONLY (src/server/tracker.ts). Filters by
 * level, grade, area, subarea, difficulty and year; the statement as text with
 * formulas, the key idea and the solution on request, the original PDF pages
 * for figures, and "Zabeleži pokušaj" into the LearnHarness log. Status dots
 * come from the learner's own log only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { BRANCHES, resolveDate, type ProblemEntry, type ProblemLog } from "@/src/core";
import { BTN, INPUT, type DialogSeed } from "./shared";

interface ArchiveProblem {
	id: string;
	title: string;
	stage: string;
	category: string;
	grade: number | null;
	year: string;
	branch: string | null;
	tags: string[];
	difficulty: number;
	kind: string;
	hasSolution: boolean;
	officialSolution: boolean;
}
type Pages = { pageStart: number; pageEnd: number } | null;
interface ArchiveDetail extends ArchiveProblem {
	name: string;
	source: string;
	statement: string;
	solution: string;
	idea: string;
	answer: string;
	taskPages: Pages;
	solutionPages: Pages;
}
interface Facets {
	stages: string[];
	grades: number[];
	branches: string[];
	tags: string[];
	years: string[];
	difficulties: number[];
}
interface ListResponse {
	available: boolean;
	problems: ArchiveProblem[];
	total: number;
	facets: Facets | null;
}

type Filters = { stage: string; grade: string; branch: string; tag: string; difficulty: string; year: string; q: string };
const EMPTY: Filters = { stage: "", grade: "", branch: "", tag: "", difficulty: "", year: "", q: "" };
// v2: the text archive (2026-11-12) — the old saved filters (category A, …) don't carry over.
const FILTER_KEY = "lh:archive-filters-v2";
const DIFFICULTY = ["", "rutinski", "lak", "srednji", "težak", "vrlo težak"];
const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));

function loadFilters(): Filters {
	try {
		const raw = window.localStorage.getItem(FILTER_KEY);
		return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Filters>) } : EMPTY;
	} catch {
		return EMPTY;
	}
}

type Status = "solved" | "again" | "none";
const DOT: Record<Status, string> = { solved: "bg-success", again: "bg-warning", none: "bg-zinc-500" };

function statusOf(e: ProblemEntry | undefined): Status {
	if (!e) return "none";
	// A planned problem (no attempts yet) is still "not done".
	if (e.attempts.length === 0) return "none";
	return resolveDate(e) ? "again" : "solved";
}

export function ArchiveTab({ log, onAttempt }: { log: ProblemLog; now: number; onAttempt: (seed: DialogSeed) => void }) {
	// Only rendered on the client (after the log loads), so storage can seed state.
	const [f, setF] = useState<Filters>(loadFilters);
	const [q, setQ] = useState(() => f.q);
	const [data, setData] = useState<ListResponse | null>(null);
	const [more, setMore] = useState<ArchiveProblem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	// The search box settles before it filters.
	useEffect(() => {
		const t = setTimeout(() => setF((x) => (x.q === q ? x : { ...x, q })), 300);
		return () => clearTimeout(t);
	}, [q]);
	const queryRef = useRef("");
	const query = useMemo(() => {
		const u = new URLSearchParams();
		for (const [k, v] of Object.entries(f)) if (v) u.set(k, v);
		return u.toString();
	}, [f]);
	useEffect(() => {
		let live = true;
		setMore([]);
		queryRef.current = query;
		try {
			window.localStorage.setItem(FILTER_KEY, JSON.stringify(f));
		} catch {
			/* storage off */
		}
		fetch(`/api/tracker/problems?${query}`, { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((d: ListResponse) => {
				if (!live) return;
				setData(d);
				setError(null);
				setSelected((s) => (s && d.problems.some((p) => p.id === s) ? s : (d.problems[0]?.id ?? null)));
			})
			.catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
		return () => {
			live = false;
		};
	}, [query, f]);
	// One "Učitaj još" at a time, and only for the filters it was asked under.
	const loading = useRef<string | null>(null);
	const loadMore = async () => {
		if (!data || loading.current !== null) return;
		const asked = query;
		loading.current = asked;
		try {
			const res = await fetch(`/api/tracker/problems?${asked}${asked ? "&" : ""}offset=${data.problems.length + more.length}`, { cache: "no-store" });
			if (res.ok && queryRef.current === asked) {
				const d = (await res.json()) as ListResponse;
				setMore((m) => {
					const seen = new Set([...data.problems, ...m].map((p) => p.id));
					return [...m, ...d.problems.filter((p) => !seen.has(p.id))];
				});
			}
		} finally {
			loading.current = null;
		}
	};
	const byTracker = useMemo(() => new Map(log.entries.filter((e) => e.trackerId).map((e) => [e.trackerId!, e])), [log]);

	if (error && !data) return <p className="mt-6 text-sm text-muted-foreground">Arhiva ne može da se učita ({error}).</p>;
	if (!data) return <p className="mt-6 text-sm text-muted-foreground">Učitavam arhivu…</p>;
	if (!data.available || !data.facets)
		return <p className="mt-6 text-lg text-muted-foreground">Arhiva zadataka nije pronađena (OneDrive\Ucenje\Takmicenja-matematika-B\podaci.json). Pokreni napravi_indeks.py u toj fascikli.</p>;

	const fc = data.facets;
	const list = [...data.problems, ...more];
	const set = (k: keyof Filters) => (v: string) => setF((x) => ({ ...x, [k]: v }));
	const sel = (label: string, k: keyof Filters, options: Array<[string, string]>) => (
		<span className="flex min-w-0 flex-col">
			<select value={f[k]} onChange={(e) => set(k)(e.target.value)} aria-label={label} className={INPUT} data-testid={`archive-${k}`}>
				<option value="">{label}: sve</option>
				{options.map(([v, l]) => (
					<option key={v} value={v}>
						{label}: {l}
					</option>
				))}
			</select>
		</span>
	);
	return (
		<>
			<div className="mt-5 flex flex-wrap items-center gap-3">
				{sel("Nivo", "stage", fc.stages.map((s) => [s, s]))}
				{sel("Razred", "grade", fc.grades.map((g) => [String(g), String(g)]))}
				{sel("Oblast", "branch", fc.branches.map((b) => [b, b]))}
				{sel("Podoblast", "tag", fc.tags.map((t) => [t, t]))}
				{sel("Težina", "difficulty", fc.difficulties.map((d) => [String(d), `${stars(d)} ${DIFFICULTY[d] ?? ""}`]))}
				{sel("Godina", "year", fc.years.map((y) => [y, y]))}
				<span className="relative min-w-56 flex-1">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pretraži…" className={cn(INPUT, "w-full pl-9")} data-testid="archive-search" />
				</span>
			</div>
			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
				<div className="flex h-[calc(100dvh-25rem)] min-h-96 flex-col rounded-lg border border-border">
					<p className="border-b border-border px-4 py-2 text-sm text-muted-foreground" data-testid="archive-total">
						{data.total} {data.total === 1 ? "zadatak" : "zadataka"}
					</p>
					<ul className="min-h-0 flex-1 overflow-y-auto">
						{list.map((p) => {
							const st = statusOf(byTracker.get(p.id));
							return (
								<li key={p.id}>
									<button
										type="button"
										onClick={() => setSelected(p.id)}
										aria-current={selected === p.id}
										data-testid="archive-item"
										className={cn(
											"flex w-full cursor-pointer items-start gap-3 border-b border-l-4 border-border px-4 py-3 text-left transition-colors hover:bg-accent",
											selected === p.id ? "border-l-amber-500! bg-accent" : "border-l-transparent!",
										)}
									>
										<span className="min-w-0 flex-1">
											<span className="block text-base font-medium">{p.title}</span>
											<span className="mt-1 flex flex-wrap items-center gap-2">
												{p.branch && <span className="inline-block rounded border border-border px-2 py-px text-sm text-foreground/85">{p.branch}</span>}
												<span className="text-sm tracking-wider text-warning" title={`težina ${p.difficulty}/5`}>
													{stars(p.difficulty)}
												</span>
											</span>
										</span>
										<span className={cn("mt-2 size-2.5 shrink-0 rounded-full", DOT[st])} title={st === "solved" ? "rešen" : st === "again" ? "za ponovno" : "nije rađen"} />
									</button>
								</li>
							);
						})}
						{list.length < data.total && (
							<li className="p-3 text-center">
								<button type="button" onClick={() => void loadMore()} className={BTN}>
									Učitaj još
								</button>
							</li>
						)}
						{!list.length && <li className="p-4 text-muted-foreground">Nijedan zadatak ne odgovara filterima.</li>}
					</ul>
					<div className="flex shrink-0 gap-5 border-t border-border px-4 py-2 text-sm text-muted-foreground">
						{(["solved", "again", "none"] as const).map((s) => (
							<span key={s} className="flex items-center gap-1.5">
								<span className={cn("size-2.5 rounded-full", DOT[s])} />
								{s === "solved" ? "rešen" : s === "again" ? "za ponovno" : "nije rađen"}
							</span>
						))}
					</div>
				</div>
				{selected ? <ArchiveDetailPanel key={selected} id={selected} entry={byTracker.get(selected)} onAttempt={onAttempt} /> : <div className="rounded-lg border border-border" />}
			</div>
		</>
	);
}

/** The archive's main areas, as the log's branches (anything else is "Ostalo"). */
const logBranch = (b: string | null) => (!b ? undefined : (BRANCHES as readonly string[]).includes(b) ? b : "Ostalo");

function ArchiveDetailPanel({ id, entry, onAttempt }: { id: string; entry: ProblemEntry | undefined; onAttempt: (seed: DialogSeed) => void }) {
	const [p, setP] = useState<ArchiveDetail | null>(null);
	const [show, setShow] = useState({ idea: false, solution: false, original: false });
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		let live = true;
		fetch(`/api/tracker/problem/${encodeURIComponent(id)}`, { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((d: ArchiveDetail | null) => live && setP(d))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [id]);
	if (!p) return <div className="rounded-lg border border-border p-4 text-muted-foreground">Učitavam…</div>;
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(`Radim zadatak iz arhive: ${p.title} (trackerId: ${p.id})`);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* clipboard off */
		}
	};
	const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }));
	const pages = (r: Pages, which: "task" | "solution", label: string) =>
		r &&
		Array.from({ length: r.pageEnd - r.pageStart + 1 }, (_, i) => (
			<div key={`${which}${i}`} className="overflow-hidden rounded border border-border bg-white">
				{/* eslint-disable-next-line @next/next/no-img-element -- a local route, no optimizer */}
				<img src={`/api/tracker/solution/${encodeURIComponent(p.id)}?which=${which}&i=${i}`} alt={`${label}, strana ${r.pageStart + i}`} className="block h-auto w-full" />
			</div>
		));
	return (
		<div className="flex h-[calc(100dvh-25rem)] min-h-96 min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-4" data-testid="archive-detail">
			<div className="shrink-0">
				<h3 className="text-lg font-semibold">{p.name}</h3>
				<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<span className="tracking-wider text-warning" title={`težina ${p.difficulty}/5`}>
						{stars(p.difficulty)}
					</span>
					<span>{DIFFICULTY[p.difficulty]}</span>
					{[p.branch, ...p.tags].filter(Boolean).map((t) => (
						<span key={t} className="rounded border border-border px-2 py-px text-foreground/85">
							{t}
						</span>
					))}
					{p.kind && <span>· {p.kind}</span>}
				</div>
			</div>
			<div className="shrink-0 text-base" data-testid="archive-statement">
				<MessageResponse>{p.statement || "_Tekst zadatka nedostaje — vidi original._"}</MessageResponse>
			</div>
			<div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">
				<button type="button" disabled={!p.idea} onClick={() => toggle("idea")} className={cn(BTN, "py-2.5 text-sm")} data-testid="show-idea">
					{show.idea ? "Sakrij ideju" : "Ključna ideja"}
				</button>
				<button type="button" disabled={!p.hasSolution} onClick={() => toggle("solution")} className={cn(BTN, "py-2.5 text-sm")} data-testid="show-solution">
					{show.solution ? "Sakrij rešenje" : p.hasSolution ? "Prikaži rešenje" : "Nema rešenja"}
				</button>
				<button type="button" disabled={!p.taskPages} onClick={() => toggle("original")} className={cn(BTN, "py-2.5 text-sm")} title="Strana iz originalnog DMS PDF-a (slike, crteži)" data-testid="show-original">
					{show.original ? "Sakrij original" : "Original (PDF)"}
				</button>
				<button
					type="button"
					onClick={() => onAttempt({ fixed: !!entry, source: entry?.source ?? "DMS arhiva", reference: entry?.reference ?? p.title, branch: logBranch(p.branch), trackerId: p.id, category: "takmicenja" })}
					className={cn(BTN, "border-success! bg-success py-2.5 text-sm font-semibold text-white hover:bg-success")}
					data-testid="archive-attempt"
				>
					Zabeleži pokušaj
				</button>
			</div>
			{show.original && <div className="flex shrink-0 flex-col gap-2">{pages(p.taskPages, "task", "Zadatak")}</div>}
			{show.idea && p.idea && (
				<div className="shrink-0 rounded-md border border-success/40 bg-success/10 p-3 text-base" data-testid="archive-idea">
					<MessageResponse>{p.idea}</MessageResponse>
				</div>
			)}
			{show.solution && p.hasSolution && (
				<div className="flex shrink-0 flex-col gap-2 rounded-md border border-border p-3" data-testid="archive-solution">
					<p className={cn("font-ui text-xs uppercase tracking-widest", p.officialSolution ? "text-muted-foreground" : "text-warning")}>
						{p.officialSolution ? "Zvanično rešenje" : "Rešenje nije zvanično (izrađeno naknadno) — proveriti"}
					</p>
					<div className="text-base">
						<MessageResponse>{p.solution + (p.answer ? `\n\n**Odgovor:** ${p.answer}` : "")}</MessageResponse>
					</div>
					{p.solutionPages && <div className="flex flex-col gap-2">{pages(p.solutionPages, "solution", "Rešenje")}</div>}
				</div>
			)}
			<div className="mt-auto flex shrink-0 flex-wrap items-center gap-3 font-ui text-xs uppercase tracking-widest text-muted-foreground">
				<span className="min-w-0 flex-1">
					{p.title} · {p.source}
				</span>
				<button type="button" onClick={() => void copy()} className={cn(BTN, "normal-case tracking-normal")} title="Kopira oznaku zadatka; nalepi je u sesiju i nastavnik ga otvara">
					{copied ? "Kopirano" : "Kopiraj za sesiju"}
				</button>
			</div>
		</div>
	);
}
