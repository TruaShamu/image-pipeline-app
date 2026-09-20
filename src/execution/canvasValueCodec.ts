import { PortDataType } from '../constants'
import { PipelineValue, blobToDataUrl } from '../nodes/types/shared'
import { ImageValue, isImageValue, ToolValue } from '../tools'

async function urlToImage(value: string): Promise<ImageValue> {
	const response = await fetch(value)
	if (!response.ok) throw new Error(`Could not load image input (${response.status})`)
	return {
		bytes: new Uint8Array(await response.arrayBuffer()),
		mimeType: response.headers.get('content-type') ?? 'image/png',
	}
}

function serializedImage(value: PipelineValue | ToolValue): ImageValue | null {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		!('bytes' in value) ||
		!Array.isArray(value.bytes) ||
		!value.bytes.every((byte) => typeof byte === 'number') ||
		!('mimeType' in value) ||
		typeof value.mimeType !== 'string'
	) {
		return null
	}
	return {
		bytes: Uint8Array.from(value.bytes),
		mimeType: value.mimeType,
		...('width' in value && typeof value.width === 'number' ? { width: value.width } : {}),
		...('height' in value && typeof value.height === 'number' ? { height: value.height } : {}),
	}
}

function dataUrlToImage(value: string): ImageValue | null {
	const match = value.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s)
	if (!match) return null
	const mimeType = match[1] || 'application/octet-stream'
	const encoded = match[2]
	const bytes = value.includes(';base64,')
		? Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
		: new TextEncoder().encode(decodeURIComponent(encoded))
	return { bytes, mimeType }
}

/** Convert a value stored by a canvas block into the native value expected by a tool. */
export async function canvasValueToToolValue(
	value: PipelineValue | ToolValue,
	type: PortDataType
): Promise<ToolValue> {
	if (type === 'image') {
		if (isImageValue(value)) return value
		const serialized = serializedImage(value)
		if (serialized) return serialized
		if (typeof value !== 'string' || !value) throw new Error('Image input requires an image')
		const embedded = dataUrlToImage(value)
		if (embedded) return embedded
		return urlToImage(value)
	}

	if (type === 'image[]') {
		if (!Array.isArray(value)) throw new Error('Image-frame input requires an array')
		return Promise.all(value.map((item) => canvasValueToToolValue(item, 'image'))) as Promise<
			ToolValue
		>
	}
	if (type === 'json' && typeof value === 'string') {
		return JSON.parse(value) as ToolValue
	}
	return value as ToolValue
}

/** Convert canvas configuration into a portable value suitable for graph YAML. */
export function canvasValueToPortableToolValue(
	value: PipelineValue,
	type: PortDataType
): ToolValue {
	if (type === 'image') {
		const serialized = serializedImage(value)
		if (serialized) return serialized
		if (typeof value === 'string') {
			const embedded = dataUrlToImage(value)
			if (embedded) return embedded
		}
		throw new Error('Image values must be embedded before saving a workflow')
	}
	if (type === 'image[]') {
		if (!Array.isArray(value)) throw new Error('Image-frame input requires an array')
		return value.map((item) => canvasValueToPortableToolValue(item, 'image'))
	}
	if (type === 'json' && typeof value === 'string') {
		return JSON.parse(value) as ToolValue
	}
	return value as ToolValue
}

/** Convert a native graph value into JSON-safe canvas configuration without losing image bytes. */
export function toolValueToCanvasConfigValue(value: ToolValue): PipelineValue {
	if (isImageValue(value)) {
		return {
			bytes: Array.from(value.bytes),
			mimeType: value.mimeType,
			...(value.width === undefined ? {} : { width: value.width }),
			...(value.height === undefined ? {} : { height: value.height }),
		}
	}
	if (Array.isArray(value)) return value.map(toolValueToCanvasConfigValue)
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				toolValueToCanvasConfigValue(child),
			])
		)
	}
	return value
}

/** Convert a native tool value into the serializable representation stored on the canvas. */
export async function toolValueToCanvasValue(value: ToolValue): Promise<PipelineValue> {
	if (isImageValue(value)) {
		return blobToDataUrl(
			new Blob([value.bytes.buffer as ArrayBuffer], { type: value.mimeType })
		)
	}
	if (Array.isArray(value)) return Promise.all(value.map(toolValueToCanvasValue))
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			await Promise.all(
				Object.entries(value).map(async ([key, child]) => [
					key,
					await toolValueToCanvasValue(child),
				])
			)
		)
	}
	return value
}
