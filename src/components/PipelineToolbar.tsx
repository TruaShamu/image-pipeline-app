import {
	AssetToolbarItem,
	createShapeId,
	DefaultActionsMenu,
	DefaultQuickActions,
	DefaultToolbar,
	DrawToolbarItem,
	Editor,
	HandToolbarItem,
	NoteToolbarItem,
	onDragFromToolbarToCreateShape,
	RectangleToolbarItem,
	SelectToolbarItem,
	TextToolbarItem,
	TldrawUiMenuGroup,
	TLShapeId,
	TLUiOverrides,
	ToolbarItem,
	Vec,
} from 'tldraw'
import { NodeShape } from '../nodes/NodeShapeUtil'
import { NodeType } from '../nodes/nodeTypes'
import { createToolNode, getToolIcon, toolNodeRegistry } from '../nodes/toolNodeData'
import { TemplatePicker } from './TemplatePicker'

function createNodeShape(editor: Editor, shapeId: TLShapeId, center: Vec, node: NodeType) {
	const markId = editor.markHistoryStoppingPoint('create node')

	editor.run(() => {
		editor.createShape({
			id: shapeId,
			type: 'node',
			props: { node },
		})

		const shape = editor.getShape<NodeShape>(shapeId)!
		const shapeBounds = editor.getShapePageBounds(shapeId)!

		const x = center.x - shapeBounds.width / 2
		const y = center.y - shapeBounds.height / 2
		editor.updateShape({ ...shape, x, y })

		editor.select(shapeId)
	})

	return markId
}

export const overrides: TLUiOverrides = {
	tools: (editor, tools, _) => {
		for (const tool of toolNodeRegistry.list()) {
			tools[`tool-${tool.id}`] = {
				id: `tool-${tool.id}`,
				label: tool.title,
				icon: getToolIcon(tool.icon),
				onSelect: () => {
					createNodeShape(
						editor,
						createShapeId(),
						editor.getViewportPageBounds().center,
						createToolNode(tool.id)
					)
				},
				onDragStart: (_, info) => {
					onDragFromToolbarToCreateShape(editor, info, {
						createShape: (id) => {
							editor.createShape({
								id,
								type: 'node',
								props: { node: createToolNode(tool.id) },
							})
						},
					})
				},
			}
		}
		return tools
	},
}

export function PipelineToolbar() {
	const tools = toolNodeRegistry.list()

	return (
		<DefaultToolbar>
			<TldrawUiMenuGroup id="selection">
				<SelectToolbarItem />
				<HandToolbarItem />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="shapes">
				<DrawToolbarItem />
				<NoteToolbarItem />
				<RectangleToolbarItem />
				<TextToolbarItem />
				<AssetToolbarItem />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="nodes">
				{tools.map((tool) => (
					<ToolbarItem key={tool.id} tool={`tool-${tool.id}`} />
				))}
			</TldrawUiMenuGroup>
			<TemplatePicker />
			<DefaultQuickActions />
			<DefaultActionsMenu />
		</DefaultToolbar>
	)
}
