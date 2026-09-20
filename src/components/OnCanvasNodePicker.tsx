import { Dialog, VisuallyHidden } from 'radix-ui'
import { useCallback, useMemo, useState } from 'react'
import {
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiButtonLabel,
	TldrawUiMenuContextProvider,
	TldrawUiMenuGroup,
	TLShapeId,
	useEditor,
	usePassThroughWheelEvents,
	useQuickReactor,
	useValue,
	Vec,
	VecModel,
} from 'tldraw'
import { getConnectionTerminals } from '../connection/ConnectionShapeUtil'
import { NODE_WIDTH_PX } from '../constants'
import { NodeType } from '../nodes/nodeTypes'
import { createToolNode, getToolIcon, toolNodeRegistry } from '../nodes/toolNodeData'
import { ToolCategory, ToolManifest } from '../tools'
import { EditorAtom } from '../utils'

export interface OnCanvasNodePickerState {
	connectionShapeId: TLShapeId
	location: 'start' | 'end' | 'middle'
	onPick: (nodeType: NodeType, position: VecModel) => void
	onClose: () => void
}

export const onCanvasNodePickerState = new EditorAtom<OnCanvasNodePickerState | null>(
	'on canvas node picker',
	() => null
)

export function OnCanvasNodePicker() {
	const editor = useEditor()
	const onClose = useCallback(() => {
		const state = onCanvasNodePickerState.get(editor)
		if (!state) return
		onCanvasNodePickerState.set(editor, null)
		state.onClose()
	}, [editor])
	const tools = toolNodeRegistry.list()
	const categories: readonly ToolCategory[] = ['input', 'process', 'output', 'utility']

	return (
		<OnCanvasNodePickerDialog onClose={onClose}>
			{categories.map((category) => {
				const categoryTools = tools.filter((tool) => tool.category === category)
				if (categoryTools.length === 0) return null
				return (
					<TldrawUiMenuGroup id={category} key={category}>
						{categoryTools.map((tool) => (
							<OnCanvasNodePickerItem tool={tool} onClose={onClose} key={tool.id} />
						))}
					</TldrawUiMenuGroup>
				)
			})}
		</OnCanvasNodePickerDialog>
	)
}

function OnCanvasNodePickerDialog({
	children,
	onClose,
}: {
	children: React.ReactNode
	onClose: () => void
}) {
	const editor = useEditor()
	const location = useValue('location', () => onCanvasNodePickerState.get(editor)?.location, [
		editor,
	])
	const shouldRender = !!location
	const [container, setContainer] = useState<HTMLDivElement | null>(null)
	usePassThroughWheelEvents(useMemo(() => ({ current: container }), [container]))

	useQuickReactor(
		'OnCanvasNodePicker',
		() => {
			const state = onCanvasNodePickerState.get(editor)
			if (!state) return

			if (!container) return

			const connection = editor.getShape(state.connectionShapeId)
			if (!connection || !editor.isShapeOfType(connection, 'connection')) {
				onClose()
				return
			}

			const terminals = getConnectionTerminals(editor, connection)
			const terminalInConnectionSpace =
				state.location === 'middle'
					? Vec.Lrp(terminals.start, terminals.end, 0.5)
					: terminals[state.location]

			const terminalInPageSpace = editor
				.getShapePageTransform(connection)
				.applyToPoint(terminalInConnectionSpace)

			const terminalInViewportSpace = editor.pageToViewport(terminalInPageSpace)
			container.style.transform = `translate(${terminalInViewportSpace.x}px, ${terminalInViewportSpace.y}px) scale(${editor.getZoomLevel()}) `
		},
		[editor, container]
	)

	return (
		<Dialog.Root
			open={shouldRender}
			modal={false}
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose()
			}}
		>
			<Dialog.Content
				ref={setContainer}
				className={`OnCanvasNodePicker OnCanvasNodePicker_${location}`}
				style={{ width: NODE_WIDTH_PX }}
			>
				<div className="OnCanvasNodePicker-content">
					<VisuallyHidden.Root>
						<Dialog.Title>Insert node</Dialog.Title>
					</VisuallyHidden.Root>
					<TldrawUiMenuContextProvider sourceId="dialog" type="menu">
						{children}
					</TldrawUiMenuContextProvider>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	)
}

function OnCanvasNodePickerItem({
	tool,
	onClose,
}: {
	tool: ToolManifest
	onClose: () => void
}) {
	const editor = useEditor()

	return (
		<TldrawUiButton
			key={tool.id}
			type="menu"
			className="OnCanvasNodePicker-button"
			onPointerDown={editor.markEventAsHandled}
			onClick={() => {
				const state = onCanvasNodePickerState.get(editor)
				if (!state) return

				const connection = editor.getShape(state.connectionShapeId)
				if (!connection || !editor.isShapeOfType(connection, 'connection')) {
					onClose()
					return
				}

				const terminals = getConnectionTerminals(editor, connection)
				const terminalInConnectionSpace =
					state.location === 'middle'
						? Vec.Lrp(terminals.start, terminals.end, 0.5)
						: terminals[state.location]

				const terminalInPageSpace = editor
					.getShapePageTransform(connection)
					.applyToPoint(terminalInConnectionSpace)

				state.onPick(createToolNode(tool.id), terminalInPageSpace)

				onClose()
			}}
		>
			<TldrawUiButtonIcon icon={getToolIcon(tool.icon)} />
			<TldrawUiButtonLabel>{tool.title}</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}
