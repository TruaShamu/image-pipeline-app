import { parse } from 'yaml'
import { parseGraph, WorkflowGraph } from '../workflow'
import { CatalogStore, useCatalog } from './catalogStore'

export interface WorkflowTemplate {
	id: string
	name: string
	description: string
	source: string
	tags: readonly string[]
	graph: WorkflowGraph
	yaml: string
}

/** `game-asset-preview` -> `Game asset preview`, for files that carry no name of their own. */
function nameFromId(id: string): string {
	const words = id.replace(/[-_]+/g, ' ').trim()
	return words ? words[0].toUpperCase() + words.slice(1) : id
}

function parseWorkflowTemplate(id: string, yaml: string): WorkflowTemplate {
	const value = (parse(yaml) ?? {}) as Record<string, unknown>
	// Only the graph is required. A workflow saved from the canvas has no description or tags to
	// write, and rejecting it for that made saving look like it worked while the file vanished
	// from the catalog. Metadata is a nicety a human adds later, not a condition of existing.
	const tags = Array.isArray(value.tags)
		? value.tags.filter((tag): tag is string => typeof tag === 'string')
		: []
	return {
		// The filename is the identity. Storing an id inside the file too would
		// let the two drift apart, and git already tracks content by path.
		id,
		name: typeof value.name === 'string' && value.name ? value.name : nameFromId(id),
		description: typeof value.description === 'string' ? value.description : '',
		source: typeof value.source === 'string' ? value.source : '',
		tags,
		graph: parseGraph(yaml),
		yaml,
	}
}

/** Workflows read from `pipelines/workflows/*.yaml`. */
export const workflowTemplateStore = new CatalogStore<WorkflowTemplate>('workflows', (file) =>
	parseWorkflowTemplate(file.id, file.yaml)
)

/** Subscribe a component to the workflow catalog. */
export function useWorkflowTemplates(): readonly WorkflowTemplate[] {
	return useCatalog(workflowTemplateStore)
}
