import { Editor } from 'tldraw'
import { stringify } from 'yaml'
import { parseLiquidVariables } from '../tools'
import { getNodePortConnections } from './nodePorts'
import { NodeShape } from './NodeShapeUtil'
import { ToolNode } from './toolNodeData'
import { PipelineValue } from './types/shared'

export interface CapturedPromptVariable {
	name: string
	type: 'text'
	required: boolean
	default?: string
}

export interface CapturedPrompt {
	template: string
	vars: CapturedPromptVariable[]
}

/** Read the literal text a `const.text` block holds, if that is what feeds this port. */
function connectedTextValue(editor: Editor, shape: NodeShape, portId: string): string | undefined {
	const connection = getNodePortConnections(editor, shape.id).find(
		(candidate) => candidate.terminal === 'end' && candidate.ownPortId === portId
	)
	if (!connection) return undefined
	const source = editor.getShape(connection.connectedShapeId)
	if (!source || source.type !== 'node') return undefined
	const node = (source as NodeShape).props.node
	// Only a literal Text block has a value worth freezing. Anything computed upstream would be
	// captured as whatever it happened to hold, which is a stale snapshot rather than a default.
	if (node.type !== 'tool' || (node as ToolNode).toolId !== 'const.text') return undefined
	const value = ((node as ToolNode).config as Record<string, PipelineValue>).value
	return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Capture a `prompt.liquid` block as a reusable preset.
 *
 * The template is the source of truth for which variables exist, so `vars` is derived from it and
 * can never declare one the template does not use. The Text blocks currently wired into those
 * ports supply the defaults — which is the point of capturing from the canvas rather than
 * hand-writing YAML: you keep the values you just finished tuning.
 */
export function capturePromptPreset(editor: Editor, shape: NodeShape): CapturedPrompt {
	const node = shape.props.node as ToolNode
	const config = node.config as Record<string, PipelineValue>
	const template = typeof config.template === 'string' ? config.template : ''
	const vars = parseLiquidVariables(template).map((name): CapturedPromptVariable => {
		const captured = connectedTextValue(editor, shape, name)
		return {
			name,
			type: 'text',
			required: true,
			...(captured === undefined ? {} : { default: captured }),
		}
	})
	return { template, vars }
}

/** Serialize a captured prompt as preset YAML matching the prompt catalog schema. */
export function promptPresetYaml(
	name: string,
	captured: CapturedPrompt,
	tags: readonly string[]
): string {
	return stringify({
		name,
		template: captured.template,
		vars: captured.vars,
		tags: [...tags],
	})
}

/** Split a comma-separated tag field into clean tags. */
export function parseTagInput(value: string): string[] {
	return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))]
}
