export const CONNECTION_CENTER_HANDLE_SIZE_PX = 16
export const CONNECTION_CENTER_HANDLE_HOVER_SIZE_PX = 24

export const NODE_WIDTH_PX = 260
export const NODE_HEADER_HEIGHT_PX = 40
export const NODE_ROW_HEADER_GAP_PX = 8
export const NODE_ROW_BOTTOM_PADDING_PX = 8
export const NODE_FOOTER_HEIGHT_PX = 40
export const NODE_ROW_HEIGHT_PX = 44
export const NODE_IMAGE_PREVIEW_HEIGHT_PX = 160 + 8

/**
 * The clear height of a block that is a window onto the canvas.
 *
 * Fixed rather than resizable: `canResizeNode` is a property of a node *type*, so making one tool
 * resizable would make every tool block resizable.
 */
export const NODE_CANVAS_REGION_HEIGHT_PX = 240

export const PORT_RADIUS_PX = 6

export const DEFAULT_NODE_SPACING_PX = 60

/**
 * Port data types define the kind of data that flows between nodes. Each type
 * has a CSS color used to tint ports and connections so users can see at a
 * glance which outputs are compatible with which inputs.
 */
/**
 * Port types used by the standalone workflow tool contract.
 *
 * The legacy node types (`model`, `number`, `latent`, and `any`) remain supported while
 * existing nodes are migrated to the workflow registry.
 */
export type PortDataType =
	| 'image'
	| 'image[]'
	| 'text'
	| 'model'
	| 'number'
	| 'int'
	| 'json'
	| 'latent'
	| 'sink'
	| 'any'

export const PORT_TYPE_COLORS: Record<PortDataType, string> = {
	image: '#c060e0',
	'image[]': '#b04ac8',
	text: '#4caf50',
	model: '#2196f3',
	number: '#9e9e9e',
	int: '#757575',
	json: '#795548',
	latent: '#ff9800',
	sink: '#607d8b',
	any: '#c08520',
}

/**
 * Whether a port carries many values rather than one.
 *
 * Arity was previously encoded only as a slightly different shade of the scalar colour, which is
 * indistinguishable on screen. Callers use this to give collections their own shape, so the
 * difference survives both a glance and colour blindness.
 */
export function isCollectionDataType(dataType: PortDataType): boolean {
	return dataType.endsWith('[]')
}

/**
 * The type of one element of a collection, or the type itself when it is already scalar.
 * `image[]` yields `image`, which is what lets a collection feed a scalar input.
 */
export function elementDataType(dataType: PortDataType): PortDataType {
	return isCollectionDataType(dataType)
		? (dataType.slice(0, -2) as PortDataType)
		: dataType
}

