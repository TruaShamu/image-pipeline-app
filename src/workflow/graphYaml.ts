import { parse, stringify } from 'yaml'
import { GraphBinding, WorkflowGraph } from './graphTypes'
import { ImageValue, ToolValue } from '../tools'

interface YamlNeed {
	port: string
	from: string
}

interface YamlStep {
	id: string
	tool: string
	with?: Record<string, ToolValue>
	needs?: YamlNeed[]
	ui?: { x: number; y: number }
}

interface YamlWorkflow {
	version: 1
	steps: YamlStep[]
}

/**
 * Human-facing metadata that lives alongside the graph.
 *
 * It is kept out of `WorkflowGraph` because the runner has no use for it, but it has to survive a
 * round trip through the canvas: saving a workflow must not silently drop the description and
 * tags a person wrote by hand.
 */
export interface WorkflowMeta {
	name?: string
	description?: string
	tags?: readonly string[]
}

function hydrateToolValue(value: ToolValue): ToolValue {
	if (Array.isArray(value)) return value.map(hydrateToolValue)
	if (typeof value !== 'object' || value === null) return value

	const object = Object.fromEntries(
		Object.entries(value).map(([key, child]) => [key, hydrateToolValue(child)])
	) as Record<string, ToolValue>
	if (
		Array.isArray(object.bytes) &&
		object.bytes.every((byte) => typeof byte === 'number') &&
		typeof object.mimeType === 'string'
	) {
		return {
			...object,
			bytes: Uint8Array.from(object.bytes),
		} as ImageValue
	}
	return object
}

function parseReference(reference: string): { stepId: string; output: string } {
	const separator = reference.lastIndexOf('.')
	if (separator <= 0 || separator === reference.length - 1) {
		throw new Error(`Invalid output reference "${reference}"`)
	}
	return { stepId: reference.slice(0, separator), output: reference.slice(separator + 1) }
}

export function serializeGraph(graph: WorkflowGraph, meta: WorkflowMeta = {}): string {
	const document = {
		...(meta.name ? { name: meta.name } : {}),
		...(meta.description ? { description: meta.description } : {}),
		...(meta.tags && meta.tags.length > 0 ? { tags: [...meta.tags] } : {}),
		version: 1,
		steps: graph.steps.map((step) => ({
			id: step.id,
			tool: step.tool,
			...(step.with && Object.keys(step.with).length > 0 ? { with: step.with } : {}),
			...(step.needs && step.needs.length > 0
				? {
						needs: step.needs.map((need) => ({
							port: need.port,
							from: `${need.from.stepId}.${need.from.output}`,
						})),
					}
				: {}),
			...(step.ui ? { ui: step.ui } : {}),
		})),
	}
	return stringify(document)
}

export function parseGraph(yaml: string): WorkflowGraph {
	const document = parse(yaml) as YamlWorkflow
	if (!document || document.version !== 1 || !Array.isArray(document.steps)) {
		throw new Error('Workflow YAML must contain version: 1 and steps: []')
	}
	return {
		version: 1,
		steps: document.steps.map((step, index) => {
			if (!step || typeof step !== 'object') {
				throw new Error(`Workflow step ${index} must be a mapping`)
			}
			if (typeof step.id !== 'string' || !step.id) {
				throw new Error(`Workflow step ${index} is missing an id`)
			}
			if (typeof step.tool !== 'string' || !step.tool) {
				throw new Error(`Workflow step "${step.id}" is missing a tool`)
			}
			if (step.needs && !Array.isArray(step.needs)) {
				throw new Error(`Workflow step "${step.id}" has invalid needs`)
			}
			return {
				id: step.id,
				tool: step.tool,
				with: step.with
					? Object.fromEntries(
							Object.entries(step.with).map(([key, value]) => [key, hydrateToolValue(value)])
						)
					: undefined,
				ui: step.ui,
				needs: step.needs?.map((need): GraphBinding => {
					if (
						!need ||
						typeof need.port !== 'string' ||
						typeof need.from !== 'string'
					) {
						throw new Error(`Workflow step "${step.id}" has an invalid input binding`)
					}
					return {
						port: need.port,
						from: parseReference(need.from),
					}
				}),
			}
		}),
	}
}
