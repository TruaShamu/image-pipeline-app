import { AtomMap, Editor, TLShapeId } from 'tldraw'
import { getNodeOutputPortInfo, getNodePortConnections, getNodePorts } from '../nodes/nodePorts'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { executeNode, getNodeDefinition } from '../nodes/nodeTypes'
import { PipelineValue, STOP_EXECUTION } from '../nodes/types/shared'
import {
	createBuiltinToolRegistry,
	resolveToolInputs,
	Tool,
	ToolRegistry,
	ToolValue,
} from '../tools'
import { NodeError, NodeResult, NodeStatus, runGraph, WorkflowGraph } from '../workflow'
import { createCanvasCapability } from './canvasCapture'
import { canvasValueToToolValue, toolValueToCanvasValue } from './canvasValueCodec'

/** A single failure, named well enough to report without the graph in hand. */
export interface ExecutionFailure {
	/** The canvas shape that failed, or null when the whole run failed before any block ran. */
	nodeId: TLShapeId | null
	/** The block's display title at the time it ran. */
	nodeTitle: string
	error: NodeError
}

interface CanvasGraphProjection {
	graph: WorkflowGraph
	registry: ToolRegistry
	shapeByStepId: Map<string, NodeShape>
}

function isNodeShape(shape: unknown): shape is NodeShape {
	return !!shape && typeof shape === 'object' && (shape as { type?: string }).type === 'node'
}

async function createLegacyTool(editor: Editor, shape: NodeShape): Promise<Tool> {
	const ports = getNodePorts(editor, shape.id)
	const definition = getNodeDefinition(editor, shape.props.node)
	return {
		id: `canvas.legacy.${shape.id}`,
		title: definition.getTitle(shape.props.node),
		description: `Compatibility adapter for legacy ${shape.props.node.type} canvas blocks.`,
		category: 'utility',
		icon: 'process',
		inputs: Object.values(ports)
			.filter((port) => port.terminal === 'end')
			.map((port) => ({
				name: port.id,
				type: port.dataType,
				required: false,
			})),
		outputs: Object.values(ports)
			.filter((port) => port.terminal === 'start')
			.map((port) => ({ name: port.id, type: port.dataType })),
		async run(inputs) {
			const current = editor.getShape(shape.id)
			if (!current || !editor.isShapeOfType(current, 'node')) {
				throw new Error(`Canvas node "${shape.id}" no longer exists`)
			}
			const canvasInputs = Object.fromEntries(
				await Promise.all(
					Object.entries(inputs).map(async ([name, value]) => [
						name,
						await toolValueToCanvasValue(value),
					])
				)
			)
			const outputs = await executeNode(editor, current, canvasInputs)
			const nativeOutputs: Record<string, ToolValue> = {}
			for (const [name, value] of Object.entries(outputs)) {
				if (value === STOP_EXECUTION) continue
				const port = ports[name]
				if (!port) continue
				nativeOutputs[name] = await canvasValueToToolValue(value, port.dataType)
			}
			return nativeOutputs
		},
	}
}

function createRegistryToolAdapter(
	shape: NodeShape,
	baseRegistry: ToolRegistry,
	editor: Editor
): Tool {
	if (shape.props.node.type !== 'tool') throw new Error('Expected a registry tool block')
	const base = baseRegistry.resolve(shape.props.node.toolId)
	return {
		...base,
		id: `canvas.tool.${shape.id}`,
		async run(inputs, context) {
			const converted: Record<string, ToolValue> = {}
			for (const input of resolveToolInputs(base, inputs)) {
				const value = inputs[input.name]
				if (value === undefined || value === null) {
					if (input.required) throw new Error(`${input.name} is required`)
					continue
				}
				converted[input.name] = await canvasValueToToolValue(value, input.type)
			}
			// The capability is bound to this block, so a region tool reads its own window and
			// nothing else.
			return base.run(converted, {
				...context,
				canvas: createCanvasCapability(editor, shape.id),
			})
		},
	}
}

async function projectCanvas(editor: Editor): Promise<CanvasGraphProjection> {
	const baseRegistry = createBuiltinToolRegistry()
	const registry = new ToolRegistry()
	const shapes = editor.getCurrentPageShapes().filter(isNodeShape)
	const shapeByStepId = new Map(shapes.map((shape) => [shape.id, shape]))
	const steps = []

	for (const shape of shapes) {
		const node = shape.props.node
		let toolId: string
		let values: Record<string, ToolValue> | undefined
		if (node.type === 'tool') {
			const adapter = createRegistryToolAdapter(shape, baseRegistry, editor)
			registry.register(adapter)
			toolId = adapter.id
			values = node.config as Record<string, ToolValue>
		} else {
			const adapter = await createLegacyTool(editor, shape)
			registry.register(adapter)
			toolId = adapter.id
		}

		steps.push({
			id: shape.id,
			tool: toolId,
			...(values && Object.keys(values).length > 0 ? { with: values } : {}),
			needs: getNodePortConnections(editor, shape)
				.filter((connection) => connection.terminal === 'end')
				.map((connection) => ({
					port: connection.ownPortId,
					from: {
						stepId: connection.connectedShapeId,
						output: connection.connectedPortId,
					},
				})),
			ui: { x: shape.x, y: shape.y },
		})
	}

	return { graph: { version: 1, steps }, registry, shapeByStepId }
}

function descendantClosure(graph: WorkflowGraph, startingIds: ReadonlySet<string>): Set<string> {
	const downstream = new Map<string, string[]>()
	for (const step of graph.steps) {
		for (const binding of step.needs ?? []) {
			const dependents = downstream.get(binding.from.stepId) ?? []
			dependents.push(step.id)
			downstream.set(binding.from.stepId, dependents)
		}
	}
	const ids = new Set<string>()
	const visit = (id: string) => {
		if (ids.has(id)) return
		ids.add(id)
		for (const dependent of downstream.get(id) ?? []) visit(dependent)
	}
	for (const id of startingIds) visit(id)
	return ids
}

async function getRetainedResults(
	editor: Editor,
	projection: CanvasGraphProjection,
	executionIds: ReadonlySet<string>
): Promise<Record<string, NodeResult>> {
	const retained: Record<string, NodeResult> = {}
	const stepById = new Map(projection.graph.steps.map((step) => [step.id, step]))
	for (const step of projection.graph.steps) {
		if (!executionIds.has(step.id)) continue
		for (const binding of step.needs ?? []) {
			if (executionIds.has(binding.from.stepId)) continue
			const sourceShape = projection.shapeByStepId.get(binding.from.stepId)
			const sourceStep = stepById.get(binding.from.stepId)
			if (!sourceShape || !sourceStep) continue
			const info = getNodeOutputPortInfo(editor, sourceShape.id)[binding.from.output]
			if (!info || info.value === STOP_EXECUTION) continue
			const output = projection.registry
				.resolve(sourceStep.tool)
				.outputs.find((candidate) => candidate.name === binding.from.output)
			if (!output) continue
			// A retained `image` output can hold a set — the step fanned out, or it was asked for
			// several images — so the stored value decides how to read it, not the declared type.
			const outputType =
				output.type === 'image' && Array.isArray(info.value) ? 'image[]' : output.type
			const result = retained[sourceStep.id] ?? { status: 'succeeded', outputs: {} }
			result.outputs![binding.from.output] = await canvasValueToToolValue(
				info.value as PipelineValue,
				outputType
			)
			retained[sourceStep.id] = result
		}
	}
	return retained
}

/** A canvas-facing run that uses runGraph as its only scheduler. */
export class CanvasExecution {
	private readonly controller = new AbortController()
	private readonly statuses = new AtomMap<TLShapeId, NodeStatus>('canvas execution status')
	private readonly progress = new AtomMap<TLShapeId, { done: number; total: number }>(
		'canvas execution progress'
	)
	private readonly failures: ExecutionFailure[] = []

	constructor(
		private readonly editor: Editor,
		private readonly startingNodeIds: ReadonlySet<TLShapeId>,
		private readonly refresh = false
	) {}

	stop() {
		this.controller.abort()
	}

	getNodeStatus(nodeId: TLShapeId): 'waiting' | 'executing' | 'executed' | undefined {
		const status = this.statuses.get(nodeId)
		if (!status) return undefined
		if (status === 'pending') return 'waiting'
		if (status === 'running') return 'executing'
		return 'executed'
	}

	/** Every node that failed during this run, in the order the failures arrived. */
	getFailures(): readonly ExecutionFailure[] {
		return this.failures
	}

	/**
	 * How far a block has progressed through a fan-out, or undefined when it is not mapping.
	 *
	 * Without this a block that runs once and a block that runs sixteen times look identical while
	 * they work, and the long wait reads as a hang.
	 */
	getNodeProgress(nodeId: TLShapeId): { done: number; total: number } | undefined {
		return this.progress.get(nodeId)
	}

	async execute() {
		const projection = await projectCanvas(this.editor)
		const executionIds = descendantClosure(projection.graph, this.startingNodeIds)
		const initialResults = await getRetainedResults(this.editor, projection, executionIds)
		const outputUpdates: Promise<void>[] = []

		const result = await runGraph(projection.graph, projection.registry, {
			executionStepIds: executionIds,
			initialResults,
			signal: this.controller.signal,
			refresh: this.refresh,
			onNode: (event) => {
				const shape = projection.shapeByStepId.get(event.id)
				if (!shape) return
				this.statuses.set(shape.id, event.status)
				if (event.progress) {
					this.progress.set(shape.id, event.progress)
				} else if (event.status !== 'running') {
					this.progress.delete(shape.id)
				}
				// A progress event repeats the running status; re-marking the shape on every
				// element of a fan-out would write to the store once per mapped item.
				if (event.status === 'running' && !event.progress) {
					this.editor.updateShape({
						id: shape.id,
						type: shape.type,
						props: { isOutOfDate: true },
					})
				}
				if (event.status === 'succeeded' && event.outputs) {
					outputUpdates.push(this.applyOutputs(shape.id, event.outputs))
				} else if (
					event.status === 'failed' ||
					event.status === 'blocked' ||
					event.status === 'cancelled'
				) {
					// A blocked node failed only because an ancestor did. Reporting those too would
					// bury the one real cause under a list of consequences.
					if (event.status === 'failed' && event.error) {
						this.failures.push({
							nodeId: shape.id,
							nodeTitle: getNodeDefinition(this.editor, shape.props.node).getTitle(
								shape.props.node
							),
							error: event.error,
						})
					}
					this.editor.updateShape({
						id: shape.id,
						type: shape.type,
						props: { isOutOfDate: false },
					})
				}
			},
		})
		await Promise.all(outputUpdates)
		if (result.validationErrors?.length) {
			throw new Error(result.validationErrors.map((error) => error.message).join('; '))
		}
		return result
	}

	private async applyOutputs(shapeId: TLShapeId, outputs: Record<string, ToolValue>) {
		const shape = this.editor.getShape(shapeId)
		if (!shape || !this.editor.isShapeOfType(shape, 'node')) return
		if (shape.props.node.type === 'tool') {
			const canvasOutputs = Object.fromEntries(
				await Promise.all(
					Object.entries(outputs).map(async ([name, value]) => [
						name,
						await toolValueToCanvasValue(value),
					])
				)
			)
			this.editor.updateShape({
				id: shape.id,
				type: shape.type,
				props: {
					node: { ...shape.props.node, lastOutputs: canvasOutputs },
					isOutOfDate: false,
				},
			})
			return
		}
		this.editor.updateShape({
			id: shape.id,
			type: shape.type,
			props: { isOutOfDate: false },
		})
	}
}
