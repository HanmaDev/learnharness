import { notFound } from "next/navigation";
import { NotesView } from "@/components/notes/notes-view";
import { getChat } from "@/src/server";

export const dynamic = "force-dynamic";

/** Fork (topic notes): one course's notes — /notes/<chatId>#step-<nodeId>. */
export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) notFound();
	return <NotesView key={id} chatId={id} />;
}
