import classNames from 'classnames'
import { useCallback } from 'react'
import {
	Circle2d,
	Group2d,
	HTMLContainer,
	RecordProps,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	T,
	TldrawUiButton,
	TldrawUiButtonLabel,
	TldrawUiDropdownMenuContent,
	TldrawUiDropdownMenuGroup,
	TldrawUiDropdownMenuItem,
	TldrawUiDropdownMenuRoot,
	TldrawUiDropdownMenuTrigger,
	TLResizeInfo,
	TLShape,
	useEditor,
	useValue,
} from 'tldraw'
import { PlayIcon, StopIcon } from '../components/icons'
import {
	NODE_FOOTER_HEIGHT_PX,
	NODE_HEADER_HEIGHT_PX,
	NODE_ROW_BOTTOM_PADDING_PX,
	NODE_ROW_HEADER_GAP_PX,
	PORT_RADIUS_PX,
} from '../constants'
import { executionState, startExecution, stopExecution } from '../execution/executionState'
import { nodeExecutionError } from '../execution/executionErrors'
import { Port } from '../ports/Port'
import { getNodeOutputPortInfo, getNodePorts } from './nodePorts'
import { getNodeDefinition, getNodeHeightPx, getNodeWidthPx, NodeBody, NodeType } from './nodeTypes'
import { resizeNode } from './resizeNode'
import { isCanvasRegionNode } from './toolNodeData'
import { NodeValue, STOP_EXECUTION } from './types/shared'
import { extensionForMimeType } from '../tools/imageFilenames'

const NODE_TYPE = 'node'

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[NODE_TYPE]: { node: NodeType; isOutOfDate: boolean }
	}
}

export type NodeShape = TLShape<typeof NODE_TYPE>

export class NodeShapeUtil extends ShapeUtil<NodeShape> {
	static override type = NODE_TYPE
	static override props: RecordProps<NodeShape> = {
		node: NodeType,
		isOutOfDate: T.boolean,
	}

	getDefaultProps(): NodeShape['props'] {
		return {
			node: getNodeDefinition(this.editor, 'tool').getDefault(),
			isOutOfDate: false,
		}
	}

	override canEdit(_shape: NodeShape) {
		return false
	}
	override canResize(shape: NodeShape) {
		return getNodeDefinition(this.editor, shape.props.node).canResizeNode
	}
	override hideResizeHandles(shape: NodeShape) {
		return !this.canResize(shape)
	}
	override hideRotateHandle(_shape: NodeShape) {
		return true
	}
	override hideSelectionBoundsBg(shape: NodeShape) {
		return !this.canResize(shape)
	}
	override hideSelectionBoundsFg(shape: NodeShape) {
		return !this.canResize(shape)
	}
	override isAspectRatioLocked(_shape: NodeShape) {
		return false
	}
	override getBoundsSnapGeometry(_shape: NodeShape) {
		return {
			points: [{ x: 0, y: 0 }],
		}
	}

	getGeometry(shape: NodeShape) {
		const ports = getNodePorts(this.editor, shape)
		const width = getNodeWidthPx(this.editor, shape)

		const portGeometries = Object.values(ports).map(
			(port) =>
				new Circle2d({
					x: port.x - PORT_RADIUS_PX,
					y: port.y - PORT_RADIUS_PX,
					radius: PORT_RADIUS_PX,
					isFilled: true,
					isLabel: true,
					excludeFromShapeBounds: true,
				})
		)

		const bodyGeometry = new Rectangle2d({
			width,
			height: getNodeHeightPx(this.editor, shape),
			isFilled: true,
		})

		return new Group2d({
			children: [bodyGeometry, ...portGeometries],
		})
	}

	override onResize(shape: any, info: TLResizeInfo<any>) {
		const definition = getNodeDefinition(this.editor, shape.props.node)
		if (definition.canResizeNode) {
			const node = shape.props.node as { w: number; h: number; type: string }
			const prevW = getNodeWidthPx(this.editor, shape)
			const prevH = getNodeHeightPx(this.editor, shape)
			const newW = Math.max(200, Math.round(prevW * info.scaleX))
			const newH = Math.max(120, Math.round(prevH * info.scaleY))
			const bodyH =
				newH -
				NODE_HEADER_HEIGHT_PX -
				NODE_ROW_HEADER_GAP_PX -
				NODE_ROW_BOTTOM_PADDING_PX -
				NODE_FOOTER_HEIGHT_PX

			return {
				...resizeNode(shape, info),
				props: {
					...shape.props,
					node: {
						...node,
						w: newW,
						h:
							NODE_HEADER_HEIGHT_PX +
							NODE_ROW_HEADER_GAP_PX +
							Math.max(0, bodyH) +
							NODE_ROW_BOTTOM_PADDING_PX +
							NODE_FOOTER_HEIGHT_PX,
					},
				},
			}
		}
		return resizeBox(shape, info)
	}

	component(shape: NodeShape) {
		return <NodeShapeComponent shape={shape} />
	}

	getIndicatorPath(shape: NodeShape) {
		const width = getNodeWidthPx(this.editor, shape)
		const height = getNodeHeightPx(this.editor, shape)
		const path = new Path2D()
		path.rect(0, 0, width, height)
		const ports = Object.values(getNodePorts(this.editor, shape))
		for (const port of ports) {
			path.moveTo(port.x + PORT_RADIUS_PX, port.y)
			path.arc(port.x, port.y, PORT_RADIUS_PX, 0, Math.PI * 2)
		}
		return path
	}
}

function NodeShapeComponent({ shape }: { shape: NodeShape }) {
	const editor = useEditor()

	const output = useValue(
		'output',
		() => getNodeOutputPortInfo(editor, shape.id)?.output ?? undefined,
		[editor, shape.id]
	)

	const isExecuting = useValue(
		'is executing',
		() => executionState.get(editor).runningGraph?.getNodeStatus(shape.id) === 'executing',
		[editor, shape.id]
	)

	// A mapped block runs once per element. Showing the count is the only way to tell a long fan-out
	// apart from a hang.
	const mapProgress = useValue(
		'map progress',
		() => executionState.get(editor).runningGraph?.getNodeProgress(shape.id) ?? null,
		[editor, shape.id]
	)

	const isGraphRunning = useValue(
		'is graph running',
		() => executionState.get(editor).runningGraph !== null,
		[editor]
	)

	const nodeDefinition = getNodeDefinition(editor, shape.props.node)

	// The block that failed is marked on the canvas too, so the report and the graph agree about
	// which one is broken without the user having to match titles by eye.
	const failure = useValue(
		'node failure',
		() => nodeExecutionError(editor, shape.id),
		[editor, shape.id]
	)

	return (
		<HTMLContainer
			className={classNames('NodeShape', {
				NodeShape_executing: isExecuting,
				NodeShape_failed: failure !== null,
				NodeShape_region: isCanvasRegionNode(shape.props.node),
			})}
			title={failure?.message}
			onContextMenu={(e) => {
				const target = e.target as HTMLElement
				const tag = target.tagName
				if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
					e.stopPropagation()
				}
			}}
		>
			<div className="NodeShape-heading">
				<div className="NodeShape-icon">{nodeDefinition.getIcon(shape.props.node)}</div>
				<div className="NodeShape-label">{nodeDefinition.getTitle(shape.props.node)}</div>
				{mapProgress && (
					<div className="NodeShape-mapProgress" title="Running once per item in a collection">
						{mapProgress.done}/{mapProgress.total}
					</div>
				)}
				{output !== undefined && (
					<>
						<div className="NodeShape-output">
							<NodeValue
								value={
									output.isOutOfDate
										? STOP_EXECUTION
										: output.multi
											? output.value[0]
											: output.value
								}
							/>
						</div>
						<Port shapeId={shape.id} portId="output" />
					</>
				)}
			</div>
			<NodeBody shape={shape} />
			<div className="NodeShape-footer">
				<button
					className={classNames('NodeShape-footer-action', {
						'NodeShape-footer-action_executing': isExecuting,
					})}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => {
						if (isGraphRunning) {
							stopExecution(editor)
						} else {
							startExecution(editor, new Set([shape.id]))
						}
					}}
				>
					{isExecuting ? <StopIcon /> : <PlayIcon />}
					<span>{isExecuting ? 'Stop' : 'Play from here'}</span>
				</button>
				<NodeFooterMenu shape={shape} />
			</div>
		</HTMLContainer>
	)
}

function NodeFooterMenu({ shape }: { shape: NodeShape }) {
	const editor = useEditor()

	const outputInfo = useValue('output info', () => getNodeOutputPortInfo(editor, shape.id), [
		editor,
		shape.id,
	])

	// Find any image output that has a valid URL
	const imageUrl = Object.values(outputInfo).find(
		(info) =>
			info.dataType === 'image' && typeof info.value === 'string' && info.value && info.value !== ''
	)?.value as string | undefined

	const node = shape.props.node as Record<string, unknown>
	// Only generation is cached, so only generation has anything to resample. "Play from here"
	// deliberately reuses cached images; this is the way to ask for new ones.
	const canGenerate = node.toolId === 'image.generate'
	const definition = getNodeDefinition(editor, shape.props.node)
	const resultKeys = definition.resultKeys
	const defaults = definition.getDefault() as Record<string, unknown>
	const hasResult = resultKeys ? resultKeys.some((key) => node[key] !== defaults[key]) : false
	const textOutput = Object.values(outputInfo).find(
		(info) => info.dataType === 'text' && typeof info.value === 'string' && info.value !== ''
	)?.value as string | undefined
	const textResult =
		textOutput ??
		(typeof node.lastResultText === 'string' && node.lastResultText !== ''
			? (node.lastResultText as string)
			: null)

	const handleDuplicate = useCallback(() => {
		editor.markHistoryStoppingPoint('duplicate node')
		editor.duplicateShapes([shape.id])
	}, [editor, shape.id])

	const handleDownloadImage = useCallback(async () => {
		if (!imageUrl) return
		const response = await fetch(imageUrl)
		const blob = await response.blob()
		const ext = extensionForMimeType(blob.type) ?? 'png'
		const blobUrl = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = blobUrl
		a.download = `image.${ext}`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(blobUrl)
	}, [imageUrl])

	const handleCopyText = useCallback(async () => {
		if (!textResult) return
		await navigator.clipboard.writeText(textResult)
	}, [textResult])

	const handleRegenerate = useCallback(() => {
		startExecution(editor, new Set([shape.id]), { refresh: true })
	}, [editor, shape.id])

	const handleClearResult = useCallback(() => {
		if (!resultKeys || resultKeys.length === 0) return
		const updates: Record<string, unknown> = {}
		for (const key of resultKeys) {
			updates[key] = defaults[key]
		}

		editor.updateShape({
			id: shape.id,
			type: shape.type,
			props: {
				node: { ...(shape.props.node as any), ...updates },
				isOutOfDate: true,
			},
		})
	}, [editor, resultKeys, defaults, shape])

	return (
		<div className="NodeFooterMenu" onPointerDown={(e) => e.stopPropagation()}>
			<TldrawUiDropdownMenuRoot id={`node-menu-${shape.id}`}>
				<TldrawUiDropdownMenuTrigger>
					<TldrawUiButton type="icon" title="More options" className="NodeFooterMenu-trigger">
						<svg width="12" height="12" viewBox="0 0 12 12">
							<circle cx="6" cy="2" r="1.2" fill="currentColor" />
							<circle cx="6" cy="6" r="1.2" fill="currentColor" />
							<circle cx="6" cy="10" r="1.2" fill="currentColor" />
						</svg>
					</TldrawUiButton>
				</TldrawUiDropdownMenuTrigger>
				<TldrawUiDropdownMenuContent side="top" align="end" sideOffset={4} alignOffset={0}>
					<TldrawUiDropdownMenuGroup>
						<TldrawUiDropdownMenuItem>
							<TldrawUiButton type="menu" onClick={handleDuplicate}>
								<TldrawUiButtonLabel>Duplicate</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuItem>
						{canGenerate && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleRegenerate}>
									<TldrawUiButtonLabel>Regenerate</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{imageUrl && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleDownloadImage}>
									<TldrawUiButtonLabel>Download image</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{textResult && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleCopyText}>
									<TldrawUiButtonLabel>Copy text</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
						{hasResult && (
							<TldrawUiDropdownMenuItem>
								<TldrawUiButton type="menu" onClick={handleClearResult}>
									<TldrawUiButtonLabel>Clear result</TldrawUiButtonLabel>
								</TldrawUiButton>
							</TldrawUiDropdownMenuItem>
						)}
					</TldrawUiDropdownMenuGroup>
				</TldrawUiDropdownMenuContent>
			</TldrawUiDropdownMenuRoot>
		</div>
	)
}

