import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

/**
 * wolfram (fork, 2026-11-08): Wolfram|Alpha for the teacher — verify every
 * computed result before posing or grading. Only registered when the learner
 * set a Wolfram App ID; the query function is injected by the composition
 * root (the agent layer never reads keys).
 */
const wolframInput = Type.Object({
	query: Type.String({
		minLength: 1,
		maxLength: 1000,
		description:
			'A single Wolfram|Alpha query in plain English or math notation, e.g. "integrate x^2 sin x dx", "solve x^2 - 5x + 6 = 0", ' +
			'"derivative of ln(x^2+1)", "is (x+1)^2 equal to x^2+2x+1", "convert 72 km/h to m/s", "limit (sin x)/x as x->0".',
	}),
});

export type WolframQuery = (query: string, signal?: AbortSignal) => Promise<string>;

export function createWolframTool(query: WolframQuery): AgentTool<typeof wolframInput> {
	return {
		name: "wolfram",
		label: "wolfram",
		description:
			"Ask Wolfram|Alpha: exact computation, algebra, calculus, equation solving, unit conversion, physical constants and formulas. " +
			"Use it to VERIFY every number, derivative, integral, solution or simplification before you pose a problem, state a result, " +
			"or grade the learner's answer. The result is for you; explain it in your own words — never paste raw output as the learner's answer.",
		parameters: wolframInput,
		execute: serverExecute("wolfram", wolframInput, async ({ query: q }, { signal }) => query(q, signal)),
	};
}
