"use client";
/**
 * Fork (problem log): the Arhiva tab — the Matematika Tracker's DMS problems,
 * READ-ONLY (src/server/tracker.ts). Filters, the statement image, the
 * official solution pages from the DMS PDF, and "Zabeleži pokušaj" into the
 * LearnHarness log. Status dots come from the learner's own log only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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
	imageId: string | null;
	hasSolution: boolean;
}
interface ArchiveDetail extends ArchiveProblem {
	source: string;
	tags: string[];
	solution: { documentId: string; pageStart: number; pageEnd: number } | null;
}
interface Facets {
	stages: string[];
	categories: string[];
	grades: number[];
	branches: string[];
	years: string[];
}
interface ListResponse {
	available: boolean;
	problems: ArchiveProblem[];
	total: number;
	facets: Facets | null;
}

type Filters = { stage: string; category: string; grade: string; branch: string; year: string; q: string };
const EMPTY: Filters = { stage: "", category: "", grade: "", branch: "", year: "", q: "" };
const FILTER_KEY = "lh:archive-filters";

function loadFilters(): Filters {
	try {
		const raw = window.localStorage.getItem(FILTER_KEY);
		return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Filters>) } : EMPTY;
	} catch {
		return EMPTY;
	}
}

type Status = "solved" | "again" | "none";
const DOT: Record<Status, string> = { solved: "bg-green-500", again: "bg-amber-500", none: "bg-zinc-500" };

function statusOf(e: ProblemEntry | undefined): Status {
	if (!e) return "none";
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
		return <p className="mt-6 text-lg text-muted-foreground">Matematika Tracker nije pronađen na ovom računaru (%APPDATA%\rs.matematika.tracker). Arhiva je dostupna samo kad je on instaliran.</p>;

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
				{sel("Kategorija", "category", fc.categories.map((c) => [c, c]))}
				{sel("Razred", "grade", fc.grades.map((g) => [String(g), String(g)]))}
				{sel("Oblast", "branch", fc.branches.map((b) => [b, b]))}
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
											{p.branch && <span className="mt-1 inline-block rounded border border-border px-2 py-px text-sm text-foreground/85">{p.branch}</span>}
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

/** The Tracker's branch names, as the log's (its "Mešovito/Ostalo" is "Ostalo"). */
const logBranch = (b: string | null) => (!b ? undefined : (BRANCHES as readonly string[]).includes(b) ? b : "Ostalo");

function ArchiveDetailPanel({ id, entry, onAttempt }: { id: string; entry: ProblemEntry | undefined; onAttempt: (seed: DialogSeed) => void }) {
	const [p, setP] = useState<ArchiveDetail | null>(null);
	const [showSolution, setShowSolution] = useState(false);
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
	return (
		<div className="flex h-[calc(100dvh-25rem)] min-h-96 min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-3" data-testid="archive-detail">
			<div className={cn("flex items-start overflow-hidden rounded bg-white p-4", showSolution ? "shrink-0" : "min-h-[30vh] flex-1")}>
				{p.imageId ? (
					// eslint-disable-next-line @next/next/no-img-element -- a local route, no optimizer
					<img src={`/api/tracker/image/${encodeURIComponent(p.imageId)}`} alt={p.title} className="h-auto max-h-[45vh] w-full object-contain object-left-top" data-testid="archive-image" />
				) : (
					<p className="w-full p-6 text-center text-zinc-600">Slika zadatka nedostaje.</p>
				)}
			</div>
			<div className="grid shrink-0 grid-cols-2 gap-3">
				<button
					type="button"
					disabled={!p.solution}
					onClick={() => setShowSolution((s) => !s)}
					className={cn(BTN, "py-2.5 text-sm")}
					title={p.solution ? undefined : "U arhivi nema zvaničnog rešenja"}
					data-testid="show-solution"
				>
					{showSolution ? "Sakrij rešenje" : p.solution ? "Prikaži rešenje" : "Nema rešenja"}
				</button>
				<button
					type="button"
					onClick={() => onAttempt({ fixed: !!entry, source: entry?.source ?? "DMS arhiva", reference: entry?.reference ?? p.title, branch: logBranch(p.branch), trackerId: p.id, category: "takmicenja" })}
					className={cn(BTN, "border-green-500! bg-green-600 py-2.5 text-sm font-semibold text-white hover:bg-green-500")}
					data-testid="archive-attempt"
				>
					Zabeleži pokušaj
				</button>
			</div>
			{showSolution && p.solution && (
				<div className="flex flex-col gap-2" data-testid="solution-pages">
					{Array.from({ length: p.solution.pageEnd - p.solution.pageStart + 1 }, (_, i) => (
						<div key={i} className="overflow-hidden rounded border border-border bg-white">
							{/* eslint-disable-next-line @next/next/no-img-element -- a local route, no optimizer */}
							<img src={`/api/tracker/solution/${encodeURIComponent(p.id)}?i=${i}`} alt={`Rešenje, strana ${p.solution!.pageStart + i}`} className="block h-auto w-full" />
						</div>
					))}
				</div>
			)}
			<div className="flex shrink-0 flex-wrap items-center gap-3 font-ui text-xs uppercase tracking-widest text-muted-foreground">
				<span className="min-w-0 flex-1">
					Izvor: {(p.source || "DMS").replace(/\s*·\s*none\b/gi, "")}
					{p.solution ? ` · rešenje str. ${p.solution.pageStart}${p.solution.pageEnd > p.solution.pageStart ? `–${p.solution.pageEnd}` : ""}` : ""}
				</span>
				<button type="button" onClick={() => void copy()} className={cn(BTN, "normal-case tracking-normal")} title="Kopira oznaku zadatka; nalepi je u sesiju i nastavnik ga otvara">
					{copied ? "Kopirano" : "Kopiraj za sesiju"}
				</button>
			</div>
		</div>
	);
}
