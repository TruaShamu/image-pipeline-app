import { createShapeId, Editor, TLShapeId } from 'tldraw'
import { createOrUpdateConnectionBinding } from '../connection/ConnectionBindingUtil'
import { getNextConnectionIndex } from '../connection/keepConnectionsAtBottom'
import { NODE_WIDTH_PX } from '../constants'
import { parseLiquidVariables, resolveToolInputs, ToolValue } from '../tools'
import { getNodePortConnections } from './nodePorts'
import { NodeShape } from './NodeShapeUtil'
import { createToolNode, ToolNode, toolNodeRegistry } from './toolNodeData'
import { PipelineValue } from './types/shared'

/** Horizontal gap between a generated Text block and the prompt it feeds. */
const SOURCE_GAP_PX = 80
/** Vertical spacing between stacked Text blocks. */
const SOURCE_STRIDE_PX = 120

/**
 * Apply a prompt preset to a `prompt.liquid` block.
 *
 * The template is stored as configuration, which makes each `{{ variable }}` appear as an input
 * port. Variable values then become real Text blocks wired into those ports, so they stay visible
 * and editable on the canvas instead of hiding inside a JSON field. Ports that already have a
 * connection are left alone so re-applying a preset never clobbers existing wiring.
 *
 * The template is copied, not referenced: the block keeps working, unchanged, if the preset is
 * later edited or deleted. `preset` records only where it came from.
 */
export function applyPromptPreset(
	editor: Editor,
	shape: NodeShape,
	template: string,
	variables: Record<string, ToolValue>,
	preset?: PipelineValue
): TLShapeId[] {
	const created: TLShapeId[] = []
	editor.run(() => {
		editor.markHistoryStoppingPoint('apply prompt preset')

		const node = shape.props.node as ToolNode
		const nextConfig = {
			...(node.config as Record<string, PipelineValue>),
			template,
			...(preset === undefined ? {} : { preset }),
		}

		editor.updateShape({
			id: shape.id,
			type: shape.type,
			props: {
				node: { ...node, config: nextConfig as ToolNode['config'] },
				isOutOfDate: true,
			},
		})

		const connections = getNodePortConnections(editor, shape.id).filter(
			(connection) => connection.terminal === 'end'
		)

		// Swapping the template changes which ports exist. A connection into a port the new template
		// no longer has would otherwise survive as a binding to nothing, so drop it. The Text block
		// it came from is left on the canvas, unwired and visible, because it may hold typed-in work.
		const remainingPorts = new Set(
			resolveToolInputs(
				toolNodeRegistry.resolve(node.toolId),
				nextConfig as unknown as Record<string, ToolValue>
			)
				.filter((input) => input.port !== false)
				.map((input) => input.name)
		)
		const stale = connections.filter((connection) => !remainingPorts.has(connection.ownPortId))
		if (stale.length > 0) {
			editor.deleteShapes(stale.map((connection) => connection.connectionId))
		}

		const connected = new Set(
			connections
				.filter((connection) => remainingPorts.has(connection.ownPortId))
				.map((connection) => connection.ownPortId)
		)

		let slot = 0
		for (const name of parseLiquidVariables(template)) {
			if (connected.has(name)) continue
			const value = variables[name]
			const textNode = createToolNode('const.text')
			const textShapeId = createShapeId()
			editor.createShape({
				id: textShapeId,
				type: 'node',
				x: shape.x - NODE_WIDTH_PX - SOURCE_GAP_PX,
				y: shape.y + slot * SOURCE_STRIDE_PX,
				props: {
					node: {
						...textNode,
						config: {
							...(textNode.config as Record<string, PipelineValue>),
							value: typeof value === 'string' ? value : String(value ?? ''),
						} as ToolNode['config'],
					},
				},
			})
			created.push(textShapeId)
			slot++

			const connectionId = createShapeId()
			editor.createShape({
				id: connectionId,
				type: 'connection',
				index: getNextConnectionIndex(editor),
			})
			createOrUpdateConnectionBinding(editor, connectionId, textShapeId, {
				portId: 'text',
				terminal: 'start',
			})
			createOrUpdateConnectionBinding(editor, connectionId, shape.id, {
				portId: name,
				terminal: 'end',
			})
		}
	})
	return created
}
