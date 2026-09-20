import { useRef } from 'react'
import { createShapeId, Editor, getPointerInfo, onDragFromToolbarToCreateShape, Vec } from 'tldraw'
import { NodeType } from '../nodes/nodeTypes'
import { createToolNode, getToolIcon } from '../nodes/toolNodeData'
import { createBuiltinToolRegistry, ToolCategory } from '../tools'
import { WorkflowActions } from './WorkflowActions'

const CATEGORY_LABELS: Record<string, string> = {
	input: 'Input',
	process: 'Process',
	output: 'Output',
	utility: 'Utility',
}

const CATEGORY_ORDER: readonly ToolCategory[] = ['input', 'process', 'output', 'utility']
const toolRegistry = createBuiltinToolRegistry()

const DRAG_DISTANCE_SQ = 36 // 6px

function createNodeAtCenter(editor: Editor, node: NodeType) {
	const shapeId = createShapeId()
	editor.run(() => {
		editor.createShape({
			id: shapeId,
			type: 'node',
			props: { node },
		})
		const shapeBounds = editor.getShapePageBounds(shapeId)!
		const center = editor.getViewportPageBounds().center
		editor.updateShape({
			id: shapeId,
			type: 'node',
			x: center.x - shapeBounds.width / 2,
			y: center.y - shapeBounds.height / 2,
		})
		editor.select(shapeId)
	})
}

function SidebarItem({
	editor,
	title,
	description,
	icon,
	getDefault,
}: {
	editor: Editor
	title: string
	description?: string
	icon: React.ReactElement
	getDefault: () => NodeType
}) {
	const stateRef = useRef<
		| { name: 'idle' }
		| { name: 'pointing'; start: { x: number; y: number } }
		| { name: 'dragging' }
		| { name: 'dragged' }
	>({ name: 'idle' })

	return (
		<button
			className="ImagePipelineSidebar-item"
			title={description}
			onPointerDown={(e) => {
				stateRef.current = {
					name: 'pointing',
					start: { x: e.clientX, y: e.clientY },
				}
				e.currentTarget.setPointerCapture(e.pointerId)
			}}
			onPointerMove={(e) => {
				if (stateRef.current.name === 'pointing') {
					const dist = Vec.Dist2(stateRef.current.start, {
						x: e.clientX,
						y: e.clientY,
					})
					if (dist > DRAG_DISTANCE_SQ) {
						const start = stateRef.current.start
						stateRef.current = { name: 'dragging' }

						editor.run(() => {
							editor.setCurrentTool('select')
							editor.dispatch({
								type: 'pointer',
								target: 'canvas',
								name: 'pointer_down',
								...getPointerInfo(editor, e.nativeEvent),
								point: start,
							})
							editor.selectNone()
							onDragFromToolbarToCreateShape(
								editor,
								{
									type: 'pointer',
									target: 'canvas',
									name: 'pointer_move',
									...getPointerInfo(editor, e.nativeEvent),
									point: start,
								},
								{
									createShape: (id) => {
										editor.createShape({
											id,
											type: 'node',
											props: { node: getDefault() },
										})
									},
								}
							)
							editor.getContainer().focus()
						})
					}
				}
			}}
			onPointerUp={(e) => {
				e.currentTarget.releasePointerCapture(e.pointerId)
				if (stateRef.current.name === 'dragging') {
					editor.dispatch({
						type: 'pointer',
						target: 'canvas',
						name: 'pointer_up',
						...getPointerInfo(editor, e.nativeEvent),
					})
					stateRef.current = { name: 'dragged' }
					return
				}
				stateRef.current = { name: 'idle' }
			}}
			onClick={() => {
				if (stateRef.current.name === 'dragged') {
					stateRef.current = { name: 'idle' }
					return
				}
				stateRef.current = { name: 'idle' }
				createNodeAtCenter(editor, getDefault())
			}}
		>
			<span className="ImagePipelineSidebar-item-icon">{icon}</span>
			<span className="ImagePipelineSidebar-item-title">{title}</span>
		</button>
	)
}

export type WorkflowPanelId = 'workflow'

export function ImagePipelineSidebar({
	editor,
	activePanel,
	onOpenPanel,
}: {
	editor: Editor
	activePanel: WorkflowPanelId | null
	onOpenPanel: (panel: WorkflowPanelId) => void
}) {
	const tools = toolRegistry.list()
	const grouped: Partial<Record<ToolCategory, typeof tools>> = {}
	for (const tool of tools) {
		const cat = tool.category
		if (!grouped[cat]) grouped[cat] = []
		grouped[cat] = [...grouped[cat]!, tool]
	}

	return (
		<div className="ImagePipelineSidebar tl-theme__light">
			<div className="ImagePipelineSidebar-header">Tools</div>
			<div className="ImagePipelineSidebar-list">
				<WorkflowActions
					editor={editor}
					catalogOpen={activePanel === 'workflow'}
					onOpenCatalog={() => onOpenPanel('workflow')}
				/>
				{CATEGORY_ORDER.map((cat) => {
					const items = grouped[cat]
					if (!items?.length) return null
					return (
						<div key={cat} className="ImagePipelineSidebar-group">
							<div className="ImagePipelineSidebar-category">{CATEGORY_LABELS[cat] ?? cat}</div>
							{items.map((tool) => (
								<SidebarItem
									key={tool.id}
									editor={editor}
									title={tool.title}
									description={tool.description}
									icon={getToolIcon(tool.icon)}
									getDefault={() => createToolNode(tool.id)}
								/>
							))}
						</div>
					)
				})}
			</div>
		</div>
	)
}
