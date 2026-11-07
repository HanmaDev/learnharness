"use client";

import { useEffect, useRef } from "react";

/**
 * Fork (2026-11-07): the exercise code editor — CodeMirror 6 with SQL/HTML
 * highlighting, line numbers, bracket matching. Ctrl/⌘+Enter runs
 * (`onRun`). CodeMirror is loaded LAZILY when an editor mounts, so the
 * question box (and everything importing it) stays light and side-effect
 * free until a code exercise actually appears.
 */

type EditorViewLike = {
	state: { doc: { toString(): string; length: number } };
	dispatch(tr: unknown): void;
	destroy(): void;
};

async function createEditor(
	parent: HTMLElement,
	doc: string,
	language: "sql" | "html",
	ariaLabel: string,
	hooks: { current: { onChange: (v: string) => void; onRun?: () => void } },
): Promise<EditorViewLike> {
	const [{ basicSetup }, { EditorView, keymap }, { EditorState, Prec }, lang] = await Promise.all([
		import("codemirror"),
		import("@codemirror/view"),
		import("@codemirror/state"),
		language === "sql" ? import("@codemirror/lang-sql").then((m) => m.sql()) : import("@codemirror/lang-html").then((m) => m.html()),
	]);
	const theme = EditorView.theme(
		{
			"&": { backgroundColor: "transparent", color: "var(--foreground)", fontSize: "13px" },
			".cm-content": { fontFamily: "var(--font-mono, ui-monospace, monospace)", caretColor: "var(--foreground)" },
			".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", border: "none" },
			".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--accent) 40%, transparent)" },
			"&.cm-focused": { outline: "none" },
			".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--primary) 30%, transparent) !important" },
		},
		{ dark: true },
	);
	return new EditorView({
		parent,
		state: EditorState.create({
			doc,
			extensions: [
				basicSetup,
				lang,
				theme,
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ "aria-label": ariaLabel, "data-exercise-focus": "" }),
				Prec.highest(
					keymap.of([
						{
							key: "Mod-Enter",
							run: () => {
								hooks.current.onRun?.();
								return true;
							},
						},
					]),
				),
				EditorView.updateListener.of((u) => {
					if (u.docChanged) hooks.current.onChange(u.state.doc.toString());
				}),
			],
		}),
	}) as unknown as EditorViewLike;
}

export function CodeEditor({
	value,
	onChange,
	language,
	onRun,
	minHeight = 96,
	ariaLabel,
	testId,
}: {
	value: string;
	onChange: (v: string) => void;
	language: "sql" | "html";
	onRun?: () => void;
	minHeight?: number;
	ariaLabel: string;
	testId?: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorViewLike | null>(null);
	const hooks = useRef({ onChange, onRun });
	hooks.current = { onChange, onRun };
	const valueRef = useRef(value);
	valueRef.current = value;

	useEffect(() => {
		const parent = host.current;
		if (!parent) return;
		let disposed = false;
		void createEditor(parent, valueRef.current, language, ariaLabel, hooks).then((v) => {
			if (disposed) v.destroy();
			else view.current = v;
		});
		return () => {
			disposed = true;
			view.current?.destroy();
			view.current = null;
		};
	}, [language, ariaLabel]);

	useEffect(() => {
		const v = view.current;
		if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
	}, [value]);

	return (
		<div
			ref={host}
			data-testid={testId}
			// Keys typed here are code, never the app's shortcuts.
			onKeyDown={(e) => e.stopPropagation()}
			className="overflow-hidden rounded-lg border bg-muted/40 focus-within:border-primary/60"
			style={{ minHeight }}
		/>
	);
}
