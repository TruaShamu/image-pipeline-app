import { Box, Editor, TLShapeId } from 'tldraw'
import { NODE_CANVAS_REGION_HEIGHT_PX, NODE_HEADER_HEIGHT_PX, NODE_ROW_HEADER_GAP_PX } from '../constants'
import { CanvasCapability, ImageValue } from '../tools'

/**
 * The drawing surface inside a block, in page space.
 *
 * This must stay identical to what `.ToolNode-region` renders: the region is drawn full width and
 * first in the body, so it starts directly below the heading and is exactly one constant tall. A
 * block's heading and footer are opaque, so a rect that included them would capture strokes the
 * user cannot see.
 */
function regionBounds(editor: Editor, shapeId: TLShapeId): Box | null {
	const bounds = editor.getShapePageBounds(shapeId)
	if (!bounds) return null
	const top = NODE_HEADER_HEIGHT_PX + NODE_ROW_HEADER_GAP_PX
	return new Box(bounds.x, bounds.y + top, bounds.w, NODE_CANVAS_REGION_HEIGHT_PX)
}

/**
 * Let a tool read the drawing behind its own block.
 *
 * Bound to one shape rather than handed the whole editor, so a tool cannot reach across the
 * canvas and read a region that is not its own.
 */
export function createCanvasCapability(editor: Editor, shapeId: TLShapeId): CanvasCapability {
	return {
		async captureRegion(): Promise<ImageValue | null> {
			const bounds = regionBounds(editor, shapeId)
			if (!bounds) return null

			// Blocks and connections are the pipeline itself, not the drawing. Including them would
			// make a sketch that overlaps another block capture that block's picture of itself.
			const drawn = [...editor.getShapeIdsInsideBounds(bounds)].filter((id) => {
				const shape = editor.getShape(id)
				return !!shape && shape.type !== 'node' && shape.type !== 'connection'
			})
			if (drawn.length === 0) return null

			const result = await editor.toImage(drawn, {
				bounds,
				padding: 0,
				background: true,
				format: 'png',
			})
			return {
				bytes: new Uint8Array(await result.blob.arrayBuffer()),
				mimeType: 'image/png',
				width: Math.round(bounds.w),
				height: Math.round(bounds.h),
			}
		},
	}
}
