import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { PlanToolResult, PlanTree } from "../../core/contracts.ts";
import type { ChatStore } from "../../core/ports.ts";
import { createTree, PlanTreeError } from "../../core/plan-tree.ts";
import { parseMermaidPlan } from "./mermaid-plan.ts";
import { computePlanProgress, isPlanDate, planProgressText } from "../../core/plan-progress.ts";
import type { LhMessage } from "../../core/native-messages.ts";

/** The binding-id reminder riding plan_init's slim content (owner,
 *  2026-10-09): plan_init is the exact moment the node ids become
 *  load-bearing — every later quiz/explain call must reference one. The
 *  field-drop incidents (tools_fails_2) showed the turn's tail is where
 *  discipline slips; the reminder lands right there. */
const PLAN_NODE_IDS_REMINDER =
	"These are the plan's node ids — the only valid nodeId values for every quiz and explain call from here on. Reference them exactly.";

/** What the plan tools close over (the plan-tree half of the tool context). */
export interface PlanToolContext {
	chatId: string;
	/** The storage port plan tools persist through. */
	chatStore: ChatStore;
}

/**
 * The plan tool — AUTHOR-ONCE protocol (2026-09-03 design pass): the teacher
 * WRITES the map and never tracks progress. One tool, plan_init, takes the
 * whole dependency map as a mermaid `graph TD` block:
 *
 *   - call it ONCE right after the probe concludes, to present the map (the
 *     LEARNER'S ACCEPTANCE of the presented plan, not this call, ends
 *     planning — docs/archive/probe-teach-split.md §4)
 *   - statuses (current / visited / upcoming) are DERIVED from the quiz
 *     nodeId tags the teacher fires (contracts.ts derivePlanStatuses) — the
 *     teacher never declares them, and there is no "done" bookkeeping
 *   - re-call it any time the map is wrong: the new block replaces the tree
 *     wholesale. Node slugs are permanent — the map tracks nothing between
 *     rewrites
 *   - checks name the node they assess (quiz nodeId, validated against the
 *     live tree at the call boundary) — that tag is the only thing statuses
 *     derive from
 *
 * The former mutation tools (add/update/remove node/edge, set_current,
 * mark_done) are gone by design: restructuring is a rewrite, tracking is
 * derived. SERVER-SIDE with execute: parse → validate → persist. The
 * result is CONTEXT-SLIM (owner, context diet 2026-10-09): the model
 * WROTE the mermaid one message ago, so content never echoes the tree —
 * it carries the validated nodeIds + the binding-nodeId reminder (the
 * exact moment the ids become load-bearing); `details` keeps the full
 * tree for the record and the plan popup (latestTree reads it — the
 * agent-invisible channel, serializer-verified).
 */
const planInitInput = Type.Object({
	// Fork: the learner's target finish date, when they gave one.
	targetDate: Type.Optional(Type.String({
		description: "The learner's target date to finish this plan, YYYY-MM-DD (ask for it while planning). Omit to keep the current one.",
	})),
	mermaid: Type.String({
		minLength: 1,
		description:
			"A mermaid graph block (any direction), e.g.:\ngraph TD\n  primitives[Number primitives] --> operators[Arithmetic operators] --> expressions[Evaluating expressions]\n" +
			"The only strict rule: ids are permanent lowercase slugs (a-z, 0-9, hyphens/underscores) — checks reference them via nodeId. " +
			"Titles are free single-line text; `-->` means 'from = prerequisite' (chains fine); no subgraphs, styles, or classes.",
	}),
});

export function planTools(ctx: PlanToolContext): Record<string, AgentTool<any>> {
	return {
		plan_init: {
			name: "plan_init",
			label: "plan_init",
			description:
				"Write or REWRITE this session's plan map — the dependency graph the learner follows live in the plan window. " +
				"Call once right after the probe concludes, to present the map; re-call whenever the map is wrong (the new block replaces the old tree). " +
				"A mermaid graph block (any direction): one node per line (`slug[Short Title]` — slugs are permanent lowercase ids: a-z, 0-9, hyphens/underscores), " +
				"`-->` edges meaning 'from must be understood before to' (chains fine). 5–15 nodes: a map, not a syllabus — one reasoning step per node, compress. " +
				"Every check you fire names the node it assesses via `nodeId`; where the lesson stands derives from those tags.",
			parameters: planInitInput,
			execute: serverExecute("plan_init", planInitInput, async ({ mermaid, targetDate }) => {
				const { chatId, chatStore } = ctx;
				const record = chatStore.getChat(chatId);
				if (!record) return { ok: false, error: `Chat not found: ${chatId}` };

				if (targetDate !== undefined && !isPlanDate(targetDate)) {
					return { ok: false, error: `targetDate must be a real calendar date as YYYY-MM-DD (got "${targetDate}").` };
				}
				const parsed = parseMermaidPlan(mermaid);
				if (!parsed.ok || !parsed.plan) {
					// The parser collects every problem; the teacher fixes and retries.
					// No tree echo — the model needs the problems, not a restatement of
					// the map it is rewriting (owner, context diet 2026-10-09).
					return { ok: false, error: parsed.problems.join("\n") };
				}
				try {
					// createTree validates the structure (duplicate ids, missing
					// edge endpoints, self-loops, cycles → PlanTreeError).
					const next = createTree(parsed.plan.nodes, parsed.plan.edges);
					chatStore.saveTree(chatId, next);
					if (targetDate !== undefined) {
						chatStore.savePlanTarget(chatId, { date: targetDate, setBy: "teacher", at: new Date().toISOString() });
					}
					const target = chatStore.getChat(chatId)?.planTarget ?? null;
					// Context diet: content = the validated nodeIds + the reminder (the
				// ids just became binding for every quiz/explain call); details =
					// the full tree for the record/UI — the plan popup's latestTree
					// seam, agent-invisible (the serializer sends content only).
					return {
						text: JSON.stringify({
							ok: true,
							nodeIds: next.nodes.map((n) => n.id),
							reminder: PLAN_NODE_IDS_REMINDER,
							targetDate: target?.date ?? null,
						}),
						details: { ok: true, tree: next },
					};
				} catch (err) {
					if (err instanceof PlanTreeError) return { ok: false, error: err.message };
					throw err;
				}
			}),
		},
		plan_progress: {
			name: "plan_progress",
			label: "plan_progress",
			description:
				"Mark plan nodes done (or reopen them) and read the learner's progress: done count, study time, estimated time left, " +
				"and pace toward the target date. `done`/`reopen` take node ids from plan_init; call with neither to just read the numbers. " +
				"The learner sees progress live in the top bar and plan view.",
			parameters: planProgressInput,
			execute: serverExecute("plan_progress", planProgressInput, async ({ done, reopen }) => {
				const { chatId, chatStore } = ctx;
				const record = chatStore.getChat(chatId);
				if (!record) return { ok: false, error: `Chat not found: ${chatId}` };
				const tree = record.tree;
				if (!tree || tree.nodes.length === 0) return { ok: false, error: "There is no plan yet — call plan_init first." };
				const ids = new Set(tree.nodes.map((n) => n.id));
				const unknown = [...(done ?? []), ...(reopen ?? [])].filter((id) => !ids.has(id));
				if (unknown.length > 0) {
					return { ok: false, error: `Unknown node id(s): ${unknown.join(", ")}. Valid ids: ${[...ids].join(", ")}.` };
				}
				// The record holds earlier turns; THIS call isn't persisted yet,
				// so fold its own change on top (same order: done, then reopen).
				const synthetic: LhMessage = {
					id: "plan_progress_now", role: "assistant", content: [{ type: "toolCall", id: "now", name: "plan_progress", arguments: { done: done ?? [], reopen: reopen ?? [] } }],
					timestamp: Date.now(),
				} as unknown as LhMessage;
				const result: LhMessage = { id: "plan_progress_now_r", role: "toolResult", toolCallId: "now", toolName: "plan_progress", content: [], isError: false, timestamp: Date.now() } as unknown as LhMessage;
				const progress = computePlanProgress({
					tree,
					messages: [...record.messages, synthetic, result],
					target: record.planTarget ?? null,
					now: Date.now(),
				});
				return { text: planProgressText(progress) };
			}),
		},
	};
}

const planProgressInput = Type.Object({
	done: Type.Optional(Type.Array(Type.String(), { description: "Node ids the learner now understands (checks justify it)." })),
	reopen: Type.Optional(Type.Array(Type.String(), { description: "Done node ids to reopen (the learner is struggling with them again)." })),
});

