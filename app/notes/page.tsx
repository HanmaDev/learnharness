import { NotesOverview } from "@/components/notes/notes-overview";

export const dynamic = "force-dynamic";

/** Fork (topic notes): every course's notes. */
export default function NotesIndexPage() {
	return <NotesOverview />;
}
