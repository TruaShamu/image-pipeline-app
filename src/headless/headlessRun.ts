import { createBuiltinToolRegistry, ToolRegistry } from '../tools'
import { parseGraph } from '../workflow/graphYaml'
import { WorkflowGraph } from '../workflow/graphTypes'
import { NodeEvent, RunGraphResult, runGraph } from '../workflow/runGraph'

/**
 * Running a workflow without the editor.
 *
 * This deliberately shares `runGraph` and `createBuiltinToolRegistry` with the canvas rather than
 * reimplementing them, so a headless run and a canvas run execute the same code against the same
 * browser image primitives. The single difference is the one the canvas runner adds on purpose:
 * it wraps each tool to supply `ToolContext.canvas`, and there is no canvas here.
 */

export interface HeadlessRunOptions {
	to?: string
	timeoutMs?: number
	/** Bypass the generation cache, producing new images for unchanged parameters. */
	refresh?: boolean
	onNode?: (event: NodeEvent) => void
}

/** A step this runner cannot execute, because its tool reads a region of the canvas. */
export interface CanvasOnlyStep {
	stepId: string
	toolId: string
	title: string
}

/**
 * Steps that need the editor, found from the manifest rather than a list of tool ids so a new
 * canvas-reading tool is covered the day it is written.
 */
export function findCanvasOnlySteps(
	graph: WorkflowGraph,
	registry: ToolRegistry
): CanvasOnlyStep[] {
	const found: CanvasOnlyStep[] = []
	for (const step of graph.steps) {
		// Unknown tools are graph validation's job to report, not this check's.
		if (!registry.has(step.tool)) continue
		const tool = registry.resolve(step.tool)
		if (!tool.canvasRegion) continue
		found.push({ stepId: step.id, toolId: tool.id, title: tool.title })
	}
	return found
}

export class CanvasOnlyStepsError extends Error {
	constructor(readonly steps: readonly CanvasOnlyStep[]) {
		const detail = steps.map((s) => `"${s.stepId}" (${s.title})`).join(', ')
		super(
			`This workflow cannot run headlessly because it draws on the canvas: ${detail}. ` +
				`Run it in the editor, or replace those steps with an input the runner can supply.`
		)
		this.name = 'CanvasOnlyStepsError'
	}
}

/**
 * Parse and run a workflow YAML document.
 *
 * Canvas-reading steps are rejected before anything executes, so the failure arrives immediately
 * and names the offending steps instead of surfacing halfway through as a missing capability.
 */
export async function runWorkflowYaml(
	yaml: string,
	options: HeadlessRunOptions = {}
): Promise<RunGraphResult> {
	const graph = parseGraph(yaml)
	const registry = createBuiltinToolRegistry()

	const canvasOnly = findCanvasOnlySteps(graph, registry)
	if (canvasOnly.length > 0) throw new CanvasOnlyStepsError(canvasOnly)

	return runGraph(graph, registry, {
		to: options.to,
		timeoutMs: options.timeoutMs,
		refresh: options.refresh,
		onNode: options.onNode,
	})
}
