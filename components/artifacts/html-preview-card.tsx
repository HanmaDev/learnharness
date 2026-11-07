"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { CodeIcon, EyeIcon, RotateCwIcon } from "lucide-react";
import { ChatActionsContext } from "@/components/chat-actions-context";
import { MessageResponse } from "@/components/ai-elements/message";
import {
	buildDemoSrcDoc,
	DemoErrorChip,
	INITIAL_DEMO_BRIDGE_STATE,
	reduceDemoBridgeState,
	type DemoBridgeState,
} from "@/components/artifacts/demo-card";
import type { ArtifactPartProps } from "@/src/core";
import { cn } from "@/lib/utils";

/**
 * html_preview card (fork): the teacher's own snippet rendered live, with a
 * Preview / Code switch. Renders straight from the call's arguments
 * (part.input) — the record IS the storage.
 *
 * Same sandbox as the demo card: allow-scripts only, no allow-same-origin
 * → opaque origin, no access to the app. The demo bridge (auto-size +
 * error reporting) is injected by buildDemoSrcDoc.
 */

interface HtmlPreviewInput {
	html?: unknown;
	title?: unknown;
}

/** A fragment gets a minimal document: UTF-8 (Serbian text) and a small
 *  body margin. Browser defaults otherwise stay — the learner should see
 *  what the markup really looks like. A full document passes untouched. */
export function htmlPreviewDocument(html: string): string {
	if (/<html[\s>]|<body[\s>]|<!doctype/i.test(html)) return html;
	return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:12px;font-family:system-ui,sans-serif}</style></head><body>${html}</body></html>`;
}

export function HtmlPreviewCard({ part }: ArtifactPartProps) {
	const input = (part.input ?? {}) as HtmlPreviewInput;
	const html = typeof input.html === "string" ? input.html : "";
	const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "HTML";
	// Streaming: the arguments are still arriving — wait for the full call.
	if (part.state === "input-streaming") return null;
	if (!html) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid="html-preview-empty">
				HTML preview could not be displayed.
			</div>
		);
	}
	return <HtmlPreviewFrame title={title} html={html} />;
}

function HtmlPreviewFrame({ title, html }: { title: string; html: string }) {
	const actions = useContext(ChatActionsContext);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [view, setView] = useState<"preview" | "code">("preview");
	const [reloadKey, setReloadKey] = useState(0);
	const [state, setState] = useState<DemoBridgeState>(INITIAL_DEMO_BRIDGE_STATE);
	const srcDoc = useMemo(() => buildDemoSrcDoc(htmlPreviewDocument(html)), [html]);
	const codeMarkdown = useMemo(() => {
		// A fence longer than any backtick run inside the source.
		const longest = Math.max(2, ...(html.match(/`+/g) ?? []).map((run) => run.length));
		const fence = "`".repeat(longest + 1);
		return `${fence}html\n${html.replace(/\n$/, "")}\n${fence}`;
	}, [html]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
			setState((prev) => reduceDemoBridgeState(prev, event.data));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	const tab = (id: "preview" | "code", label: string, Icon: typeof EyeIcon) => (
		<button
			type="button"
			onClick={() => setView(id)}
			aria-pressed={view === id}
			data-testid={`html-preview-tab-${id}`}
			className={cn(
				"flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
				view === id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
			)}
		>
			<Icon className="size-3.5" />
			{label}
		</button>
	);

	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="html-preview-card">
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">html preview</span>
					<span className="truncate text-xs font-medium tracking-wide text-foreground">{title}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{tab("preview", "Preview", EyeIcon)}
					{tab("code", "Code", CodeIcon)}
					<button
						type="button"
						aria-label="Reload preview"
						title="Reload"
						onClick={() => {
							setState(INITIAL_DEMO_BRIDGE_STATE);
							setReloadKey((k) => k + 1);
							setView("preview");
						}}
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<RotateCwIcon className="size-3.5" />
					</button>
				</div>
			</div>
			{state.error && (
				<DemoErrorChip
					title={title}
					message={state.error}
					onSend={actions ? () => actions.sendText(`The HTML preview "${title}" threw an error: ${state.error}`) : undefined}
				/>
			)}
			{/* The frame stays mounted under the Code view so scripts keep their state. */}
			<iframe
				key={reloadKey}
				ref={iframeRef}
				title={title}
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				scrolling="no"
				className={cn("mt-2 w-full rounded-lg border bg-white", view !== "preview" && "hidden")}
				style={{ height: state.height ?? 200, boxSizing: "content-box" }}
				data-testid="html-preview-iframe"
			/>
			{view === "code" && (
				<div className="mt-2" data-testid="html-preview-code">
					<MessageResponse>{codeMarkdown}</MessageResponse>
				</div>
			)}
		</div>
	);
}
