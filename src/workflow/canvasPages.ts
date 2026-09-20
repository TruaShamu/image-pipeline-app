import { createShapeId, Editor, TLPageId, TLShapeId } from 'tldraw'
import { createOrUpdateConnectionBinding } from '../connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from '../connection/keepConnectionsAtBottom'
import {
	canvasValueToPortableToolValue,
	toolValueToCanvasConfigValue,
} from '../execution/canvasValueCodec'
import { getNodePortConnections } from '../nodes/nodePorts'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { createToolNode, toolNodeRegistry } from '../nodes/toolNodeData'
import { PipelineValue } from '../nodes/types/shared'
import { ToolValue } from '../tools'
import { WorkflowGraph } from './graphTypes'
import { parseGraph } from './graphYaml'
import { validateGraph } from './graphValidation'

function createNamedPage(editor: Editor, name: string): TLPageId {
	const existing = new Set(editor.getPages().map((page) => page.id))
	editor.createPage({ name })
	const page = editor.getPages().find((candidate) => !existing.has(candidate.id))
	if (!page) throw new Error(`Could not create canvas page "${name}"`)
	editor.setCurrentPage(page.id)
	return page.id
}

function isNodeShape(shape: unknown): shape is NodeShape {
	return !!shape && typeof shape === 'object' && (shape as { type?: string }).type === 'node'
}

/** True when a hidden metadata value still holds its empty default. */
function isUnsetMetadata(value: PipelineValue): boolean {
	if (value === '') return true
	if (Array.isArray(value)) return value.length === 0
	if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0
	return false
}

/** Export the current generic-tool canvas as executable workflow steps. */
export function exportCurrentPageGraph(editor: Editor): WorkflowGraph {
	const shapes = editor
		.getCurrentPageShapes()
		.filter(isNodeShape)
		.sort((a, b) => a.y - b.y || a.x - b.x)

	const ids = new Map<TLShapeId, string>()
	const counts = new Map<string, number>()
	for (const shape of shapes) {
		const node = shape.props.node
		if (node.type !== 'tool') {
			throw new Error(
				`"${node.type}" is a legacy canvas block. Catalog workflows can only contain registry tools.`
			)
		}
		const base = node.toolId.replace(/[^a-zA-Z0-9_-]+/g, '-')
		const count = (counts.get(base) ?? 0) + 1
		counts.set(base, count)
		ids.set(shape.id, `${base}-${count}`)
	}

	return {
		version: 1,
		steps: shapes.map((shape) => {
			const node = shape.props.node
			if (node.type !== 'tool') throw new Error('Expected a registry tool node')
			const needs = getNodePortConnections(editor, shape)
				.filter((connection) => connection.terminal === 'end')
				.map((connection) => {
					const stepId = ids.get(connection.connectedShapeId)
					if (!stepId) {
						throw new Error(`Input "${connection.ownPortId}" is connected outside this workflow`)
					}
					return {
						port: connection.ownPortId,
						from: { stepId, output: connection.connectedPortId },
					}
				})
			return {
				id: ids.get(shape.id)!,
				tool: node.toolId,
				with: Object.fromEntries(
					toolNodeRegistry.resolve(node.toolId).inputs.flatMap((input) => {
						const value = (node.config as Record<string, PipelineValue>)[input.name]
						if (value === undefined || value === null) return []
						// Hidden inputs are authoring metadata, not pipeline inputs. Writing one that
						// was never set (an unapplied `preset: {}`) is diff noise claiming a link
						// that does not exist. Visible inputs are always written, so a workflow keeps
						// recording the values it actually ran with.
						if (input.hidden && isUnsetMetadata(value)) return []
						return [[input.name, canvasValueToPortableToolValue(value, input.type)]]
					})
				) as Record<string, ToolValue>,
				...(needs.length > 0 ? { needs } : {}),
				ui: { x: Math.round(shape.x), y: Math.round(shape.y) },
			}
		}),
	}
}

/** Materialize canonical executable steps as their generic canvas representation. */
export function importGraphOnCurrentPage(editor: Editor, graph: WorkflowGraph): TLShapeId[] {
	const validation = validateGraph(graph, toolNodeRegistry)
	if (!validation.valid) {
		throw new Error(validation.errors.map((error) => error.message).join('; '))
	}
	const createdNodeIds: TLShapeId[] = []
	editor.run(() => {
		editor.markHistoryStoppingPoint('import workflow graph')
		const existing = editor
			.getCurrentPageShapes()
			.filter((shape) => shape.type === 'node' || shape.type === 'connection')
		if (existing.length > 0) editor.deleteShapes(existing.map((shape) => shape.id))

		const shapeIdByStepId = new Map<string, TLShapeId>()
		graph.steps.forEach((step, index) => {
			const shapeId = createShapeId()
			const node = createToolNode(step.tool)
			shapeIdByStepId.set(step.id, shapeId)
			editor.createShape({
				id: shapeId,
				type: 'node',
				x: step.ui?.x ?? 80 + index * 280,
				y: step.ui?.y ?? 100,
				props: {
					node: {
						...node,
						config: {
							...(node.config as Record<string, unknown>),
							...Object.fromEntries(
								Object.entries(step.with ?? {}).map(([key, value]) => [
									key,
									toolValueToCanvasConfigValue(value),
								])
							),
						} as typeof node.config,
					},
				},
			})
			createdNodeIds.push(shapeId)
		})

		for (const step of graph.steps) {
			const toId = shapeIdByStepId.get(step.id)
			if (!toId) continue
			for (const binding of step.needs ?? []) {
				const fromId = shapeIdByStepId.get(binding.from.stepId)
				if (!fromId) {
					throw new Error(
						`Workflow step "${step.id}" references missing step "${binding.from.stepId}"`
					)
				}
				const connectionId = createShapeId()
				editor.createShape({
					id: connectionId,
					type: 'connection',
					index: getNextConnectionIndex(editor),
				})
				createOrUpdateConnectionBinding(editor, connectionId, fromId, {
					portId: binding.from.output,
					terminal: 'start',
				})
				createOrUpdateConnectionBinding(editor, connectionId, toId, {
					portId: binding.port,
					terminal: 'end',
				})
			}
		}
	})
	return createdNodeIds
}

/** Open a built-in executable graph on a new named tldraw page. */
export function openGraphOnNewPage(editor: Editor, name: string, graph: WorkflowGraph): TLPageId {
	const previousPageId = editor.getCurrentPageId()
	const pageId = createNamedPage(editor, name)
	try {
		importGraphOnCurrentPage(editor, graph)
		editor.zoomToFit({ animation: { duration: 200 } })
		return pageId
	} catch (error) {
		editor.setCurrentPage(previousPageId)
		editor.deletePage(pageId)
		throw error
	}
}

/** Open workflow YAML on a new named tldraw page. */
export function openWorkflowYamlOnNewPage(editor: Editor, name: string, yaml: string): TLPageId {
	return openGraphOnNewPage(editor, name, parseGraph(yaml))
}
