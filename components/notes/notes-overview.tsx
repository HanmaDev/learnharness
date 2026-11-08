"use client";
/** Fork (topic notes): every course's notes, one row each. */
import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { useLiveJson } from "@/components/live-json";

interface NotesCourse {
	chatId: string;
	title: string;
	courseTitle: string;
	total: number;
	written: number;
	taught: number;
	updatedAt: string | null;
}

export function NotesOverview() {
	const { data, error } = useLiveJson<{ courses: NotesCourse[] }>("/api/notes", { debounceMs: 2_000 });
	return (
		<div className="flex h-dvh min-w-0 flex-1 flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Beleške</h1>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto pb-16 font-prose">
				<div className="mx-auto w-full max-w-5xl px-8 pt-8">
					{error && !data && <p className="text-sm text-muted-foreground">Beleške ne mogu da se učitaju ({error}).</p>}
					{data && data.courses.length === 0 && <p className="text-base text-muted-foreground">Još nema kurseva sa planom.</p>}
					<div className="flex flex-col gap-4">
						{data?.courses.map((c) => (
							<Link
								key={c.chatId}
								href={`/notes/${encodeURIComponent(c.chatId)}`}
								data-testid="notes-course"
								className="flex items-center gap-6 rounded-lg border border-border bg-white/[0.035] px-6 py-5 transition-colors hover:bg-white/[0.06]"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-2xl text-foreground">{c.courseTitle}</p>
									<p className="mt-1 text-lg text-foreground/75">
										{c.written} od {c.taught} obrađenih koraka napisano · {c.total} u planu
									</p>
								</div>
								<span className="font-ui text-xs uppercase tracking-wider text-muted-foreground">Otvori →</span>
							</Link>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
