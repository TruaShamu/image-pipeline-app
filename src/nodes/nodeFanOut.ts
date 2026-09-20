import { Editor, TLShapeId } from 'tldraw'
import { effectiveOutputType, resolveToolInputs, ToolManifest, ToolValue } from '../tools'
import { getNodePortConnections } from './nodePorts'
import { NodeShape } from './NodeShapeUtil'
import { toolNodeRegistry } from './toolNodeData'

/**
 * Whether a block runs once per element rather than once.
 *
 * A block cannot answer this from its own configuration: it depends on what is plugged into it,
 * and on whatever is plugged into that. `image.adjust` takes one image, but fed the four images
 * from a `count: 4` generate it runs four times and its `image` output carries all four — so its
 * output port has to be drawn as a collection, and accept a connection to a collection input.
 *
 * This mirrors `getFanOutSteps` in `graphValidation`, which decides the same thing for a parsed
 * workflow. The canvas needs it before there is a workflow to parse, so the walk here is over
 * connections rather than over `needs`. Both go through `effectiveOutputType`, so a block cannot
 * be drawn one way and validated another.
 */
export function nodeFansOut(
	editor: Editor,
	shapeId: TLShapeId,
	visiting: Set<TLShapeId> = new Set()
): boolean {
	// A cycle is reported by validation; treat it as non-fanning rather than recursing forever.
	if (visiting.has(shapeId)) return false
	const tool = toolAt(editor, shapeId)
	if (!tool) return false

	visiting.add(shapeId)
	try {
		const inputs = resolveToolInputs(tool.manifest, tool.config)
		for (const connection of getNodePortConnections(editor, shapeId)) {
			// `end` is an inbound connection: something feeding one of this block's inputs.
			if (connection.terminal !== 'end') continue
			const input = inputs.find((candidate) => candidate.name === connection.ownPortId)
			// Only a scalar image input maps. A tool declaring `image[]` asked for the whole set.
			if (!input || input.type !== 'image') continue
			const sourceType = outputTypeAt(
				editor,
				connection.connectedShapeId,
				connection.connectedPortId,
				visiting
			)
			if (sourceType === 'image[]') return true
		}
		return false
	} finally {
		visiting.delete(shapeId)
	}
}

/** The type an output port on another block actually carries. */
function outputTypeAt(
	editor: Editor,
	shapeId: TLShapeId,
	outputName: string,
	visiting: Set<TLShapeId>
): string | null {
	const tool = toolAt(editor, shapeId)
	if (!tool) return null
	const output = tool.manifest.outputs.find((candidate) => candidate.name === outputName)
	if (!output) return null
	return effectiveOutputType(
		tool.manifest,
		output,
		tool.config,
		nodeFansOut(editor, shapeId, visiting)
	)
}

function toolAt(
	editor: Editor,
	shapeId: TLShapeId
): { manifest: ToolManifest; config: Record<string, ToolValue> } | null {
	const shape = editor.getShape(shapeId) as NodeShape | undefined
	if (!shape || shape.type !== 'node') return null
	const node = shape.props.node as {
		type: string
		toolId?: string
		config?: Record<string, ToolValue>
	}
	if (node.type !== 'tool' || !node.toolId || !toolNodeRegistry.has(node.toolId)) return null
	return {
		manifest: toolNodeRegistry.resolve(node.toolId),
		config: node.config ?? {},
	}
}
