import { T, TLUiIconJsx } from 'tldraw'
import { createBuiltinToolRegistry, Tool, ToolIcon, ToolValue } from '../tools'
import {
	AdjustIcon,
	DownloadIcon,
	GenerateIcon,
	ImageIcon,
	PreviewIcon,
	PromptIcon,
	TextIcon,
} from '../components/icons'

export const toolNodeRegistry = createBuiltinToolRegistry()

export type ToolNode = T.TypeOf<typeof ToolNode>
export const ToolNode = T.object({
	type: T.literal('tool'),
	toolId: T.string,
	config: T.jsonValue,
	lastOutputs: T.jsonValue,
})

const TOOL_ICONS: Record<ToolIcon, () => TLUiIconJsx> = {
	text: TextIcon,
	image: ImageIcon,
	prompt: PromptIcon,
	generate: GenerateIcon,
	process: AdjustIcon,
	preview: PreviewIcon,
	download: DownloadIcon,
}

export function getToolIcon(icon: ToolIcon): TLUiIconJsx {
	const Icon = TOOL_ICONS[icon] ?? AdjustIcon
	return <Icon />
}

function defaultConfig(tool: Tool): Record<string, ToolValue> {
	return Object.fromEntries(
		tool.inputs
			.filter((input) => input.port === false)
			.map((input) => [
				input.name,
				input.default ??
					(input.type === 'json'
						? {}
						: input.type === 'int' || input.type === 'number'
							? 0
							: input.type === 'image[]'
								? []
								: input.type === 'image'
									? null
									: ''),
			])
	)
}

export function createToolNode(toolId: string): ToolNode {
	const tool = toolNodeRegistry.resolve(toolId)
	return {
		type: 'tool',
		toolId,
		config: defaultConfig(tool) as unknown as ToolNode['config'],
		lastOutputs: {},
	}
}

/**
 * Whether a block is a transparent window onto the canvas rather than a panel of rows.
 *
 * Read from the tool manifest rather than matched on a node type or tool id, so the canvas gains
 * no knowledge of which particular tools read the drawing behind them.
 */
export function isCanvasRegionNode(node: { type: string; toolId?: string }): boolean {
	if (node.type !== 'tool' || !node.toolId) return false
	return (
		toolNodeRegistry.has(node.toolId) && toolNodeRegistry.resolve(node.toolId).canvasRegion === true
	)
}
