import { ImageValue, Tool, ToolHttpError, ToolValue } from './toolTypes'
import { withMatchingExtension } from './imageFilenames'
import { parseLiquidVariables } from './liquidTemplate'
import { zipSync } from 'fflate'
import { applyPalette, GIFEncoder, quantize } from 'gifenc'
import { Liquid } from 'liquidjs'

const liquid = new Liquid()

function asString(value: ToolValue | undefined, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string`)
	return value
}

function asImage(value: ToolValue | undefined, name: string): ImageValue {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		!('bytes' in value) ||
		!(value.bytes instanceof Uint8Array)
	) {
		throw new Error(`${name} must be an ImageValue`)
	}
	return value as ImageValue
}

/**
 * Encode image bytes as a data URL for transport to the API.
 *
 * Graph values are raw bytes, but `/api/generate` takes a URL, so a connected
 * image has to be inlined rather than referenced.
 */
function toDataUrl(image: ImageValue): string {
	let binary = ''
	// Chunked so a large image doesn't blow the argument limit of `fromCharCode`.
	const chunkSize = 0x8000
	for (let index = 0; index < image.bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...image.bytes.subarray(index, index + chunkSize))
	}
	return `data:${image.mimeType};base64,${btoa(binary)}`
}

async function fetchImage(url: string): Promise<ImageValue> {
	const response = await fetch(url)
	if (!response.ok) throw new ToolHttpError(`Image download failed (${response.status})`, response.status)
	const bytes = new Uint8Array(await response.arrayBuffer())
	return { bytes, mimeType: response.headers.get('content-type') ?? 'image/png' }
}

function downloadBytes(bytes: Uint8Array, mimeType: string, filename: string): void {
	if (typeof document === 'undefined') {
		throw new Error('Download sinks require a browser runtime')
	}
	const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }))
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = filename
	anchor.click()
	URL.revokeObjectURL(url)
}

export const constTextTool: Tool = {
	id: 'const.text',
	title: 'Text',
	description: 'Provide a fixed text value.',
	category: 'input',
	icon: 'text',
	inputs: [
		{ name: 'value', type: 'text', required: true, port: false, default: '', multiline: true },
	],
	outputs: [{ name: 'text', type: 'text' }],
	async run(inputs) {
		return { text: asString(inputs.value, 'value') }
	},
}

export const constImageTool: Tool = {
	id: 'const.image',
	title: 'Image',
	description: 'Provide a fixed image from a local file.',
	category: 'input',
	icon: 'image',
	inputs: [{ name: 'value', type: 'image', required: true, port: false }],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs) {
		return { image: asImage(inputs.value, 'value') }
	},
}

export const promptLiquidTool: Tool = {
	id: 'prompt.liquid',
	title: 'Liquid Prompt',
	description: 'Render a reusable prompt template with variables.',
	category: 'input',
	icon: 'prompt',
	inputs: [
		{
			name: 'template',
			type: 'text',
			required: true,
			port: false,
			multiline: true,
			default: 'a {{ subject }} in the style of {{ style }}',
		},
		{ name: 'preset', type: 'json', required: false, port: false, hidden: true },
	],
	// Every `{{ variable }}` in the template becomes a connectable text input, so values come from
	// Text blocks on the canvas rather than a JSON blob.
	dynamicInputs: (config) =>
		parseLiquidVariables(typeof config.template === 'string' ? config.template : '').map(
			(name) => ({ name, type: 'text', required: false, port: true, default: '' })
		),
	outputs: [{ name: 'text', type: 'text' }],
	async run(inputs) {
		const template = asString(inputs.template, 'template')
		const scope: Record<string, ToolValue> = {}
		for (const name of parseLiquidVariables(template)) {
			scope[name] = inputs[name] ?? ''
		}
		return { text: await liquid.parseAndRender(template, scope) }
	},
}

export const imageGenerateTool: Tool = {
	id: 'image.generate',
	title: 'Generate Image',
	description: 'Generate an image from a prompt.',
	category: 'process',
	icon: 'generate',
	inputs: [
		{ name: 'prompt', type: 'text', required: true },
		{ name: 'reference', type: 'image', required: false },
		{
			name: 'model',
			type: 'text',
			required: false,
			default: 'openai:gpt-image-1.5',
			port: false,
			optionsSource: 'models',
		},
		// Azure accepts any size whose sides are both divisible by 16, but an open text field
		// invites a 400. These are the shapes the models are actually tuned for.
		{
			name: 'size',
			type: 'text',
			required: false,
			default: 'auto',
			port: false,
			options: [
				{ value: 'auto', label: 'Auto' },
				{ value: '1024x1024', label: 'Square 1024' },
				{ value: '1536x1024', label: 'Landscape 1536x1024' },
				{ value: '1024x1536', label: 'Portrait 1024x1536' },
			],
		},
		{
			name: 'quality',
			type: 'text',
			required: false,
			default: 'auto',
			port: false,
			options: [
				{ value: 'auto', label: 'Auto' },
				{ value: 'low', label: 'Low' },
				{ value: 'medium', label: 'Medium' },
				{ value: 'high', label: 'High' },
			],
		},
		// Generating on transparency directly beats generating a background and cutting it out.
		{
			name: 'background',
			type: 'text',
			required: false,
			default: 'auto',
			port: false,
			options: [
				{ value: 'auto', label: 'Auto' },
				{ value: 'transparent', label: 'Transparent' },
				{ value: 'opaque', label: 'Opaque' },
			],
		},
		{
			name: 'format',
			type: 'text',
			required: false,
			default: 'png',
			port: false,
			options: [
				{ value: 'png', label: 'PNG' },
				{ value: 'jpeg', label: 'JPEG' },
			],
		},
	],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs, context) {
		const reference = inputs.reference
		const format = asString(inputs.format ?? 'png', 'format')
		// JPEG cannot carry an alpha channel, so asking for both is a contradiction worth naming
		// here rather than letting the model quietly return an opaque image.
		const background = asString(inputs.background ?? 'auto', 'background')
		if (background === 'transparent' && format !== 'png') {
			throw new Error('A transparent background needs the PNG format.')
		}
		const response = await fetch('/api/generate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				prompt: asString(inputs.prompt, 'prompt'),
				model: asString(inputs.model, 'model'),
				// `auto` means "let the model decide", which the API expresses by omission.
				...optionalSetting('size', inputs.size),
				...optionalSetting('quality', inputs.quality),
				...optionalSetting('background', inputs.background),
				outputFormat: format,
				// A connected image turns this into an image-to-image edit.
				...(reference == null
					? {}
					: { referenceImageUrl: toDataUrl(asImage(reference, 'image')) }),
			}),
			signal: context.signal,
		})
		const body = (await response.json()) as { imageUrl?: string; error?: string }
		if (!response.ok || !body.imageUrl) {
			throw new ToolHttpError(
				body.error ?? `Image generation failed (${response.status})`,
				response.status
			)
		}
		return { image: await fetchImage(body.imageUrl) }
	},
}

/** Include a generation setting only when it names a real choice rather than "auto". */
function optionalSetting(name: string, value: ToolValue | undefined): Record<string, string> {
	const text = typeof value === 'string' ? value : ''
	return text && text !== 'auto' ? { [name]: text } : {}
}

export const imageRemoveBackgroundTool: Tool = {
	id: 'image.removeBackground',
	title: 'Remove Background',
	description: 'Remove a solid background from an image.',
	category: 'process',
	icon: 'process',
	inputs: [
		{ name: 'source', type: 'image', required: true },
		{ name: 'tolerance', type: 'int', required: false, default: 24, port: false },
	],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs) {
		const image = asImage(inputs.source, 'source')
		const tolerance = inputs.tolerance
		if (typeof tolerance !== 'number' || !Number.isInteger(tolerance) || tolerance < 0) {
			throw new Error('tolerance must be a non-negative integer')
		}
		if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
			throw new Error('image.removeBackground requires a browser image runtime')
		}
		const bitmap = await createImageBitmap(
			new Blob([image.bytes.buffer as ArrayBuffer], { type: image.mimeType })
		)
		const canvas = document.createElement('canvas')
		canvas.width = bitmap.width
		canvas.height = bitmap.height
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('Could not create a 2D canvas context')
		context.drawImage(bitmap, 0, 0)
		const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
		const [red, green, blue] = pixels.data
		const threshold = tolerance * tolerance
		for (let index = 0; index < pixels.data.length; index += 4) {
			const redDelta = pixels.data[index] - red
			const greenDelta = pixels.data[index + 1] - green
			const blueDelta = pixels.data[index + 2] - blue
			if (redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta <= threshold) {
				pixels.data[index + 3] = 0
			}
		}
		context.putImageData(pixels, 0, 0)
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('Could not encode image'))),
				'image/png'
			)
		})
		bitmap.close()
		return {
			image: {
				bytes: new Uint8Array(await blob.arrayBuffer()),
				mimeType: 'image/png',
				width: canvas.width,
				height: canvas.height,
			},
		}
	},
}

const BLEND_COMPOSITE_OPS: Record<string, GlobalCompositeOperation> = {
	normal: 'source-over',
	multiply: 'multiply',
	screen: 'screen',
	overlay: 'overlay',
	difference: 'difference',
}

function asNumber(value: ToolValue | undefined, name: string, fallback: number): number {
	if (value === undefined || value === null || value === '') return fallback
	const parsed = typeof value === 'number' ? value : Number(value)
	if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`)
	return parsed
}

/** Draw into a canvas sized to the given dimensions and return the result as PNG bytes. */
async function renderToImage(
	width: number,
	height: number,
	draw: (context: CanvasRenderingContext2D) => void
): Promise<ImageValue> {
	if (typeof document === 'undefined') {
		throw new Error('This tool requires a browser image runtime')
	}
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext('2d')
	if (!context) throw new Error('Could not create a 2D canvas context')
	draw(context)
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(value) => (value ? resolve(value) : reject(new Error('Could not encode image'))),
			'image/png'
		)
	})
	return {
		bytes: new Uint8Array(await blob.arrayBuffer()),
		mimeType: 'image/png',
		width,
		height,
	}
}

/** Decode an `ImageValue` into a bitmap the canvas can draw. */
async function toBitmap(image: ImageValue): Promise<ImageBitmap> {
	if (typeof createImageBitmap !== 'function') {
		throw new Error('This tool requires a browser image runtime')
	}
	return createImageBitmap(new Blob([image.bytes.buffer as ArrayBuffer], { type: image.mimeType }))
}

export const imageBlendTool: Tool = {
	id: 'image.blend',
	title: 'Blend Images',
	description: 'Composite two images using a blend mode.',
	category: 'process',
	icon: 'process',
	inputs: [
		{ name: 'imageA', type: 'image', required: true },
		{ name: 'imageB', type: 'image', required: true },
		{
			name: 'mode',
			type: 'text',
			required: false,
			default: 'normal',
			port: false,
			options: [
				{ value: 'normal', label: 'Normal' },
				{ value: 'multiply', label: 'Multiply' },
				{ value: 'screen', label: 'Screen' },
				{ value: 'overlay', label: 'Overlay' },
				{ value: 'difference', label: 'Difference' },
			],
		},
		{ name: 'opacity', type: 'number', required: false, default: 50, port: false },
	],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs) {
		const imageA = asImage(inputs.imageA, 'imageA')
		const imageB = asImage(inputs.imageB, 'imageB')
		const mode = typeof inputs.mode === 'string' ? inputs.mode : 'normal'
		const opacity = asNumber(inputs.opacity, 'opacity', 50)
		if (opacity < 0 || opacity > 100) throw new Error('opacity must be between 0 and 100')

		const [bitmapA, bitmapB] = await Promise.all([toBitmap(imageA), toBitmap(imageB)])
		const width = Math.max(bitmapA.width, bitmapB.width)
		const height = Math.max(bitmapA.height, bitmapB.height)
		const result = await renderToImage(width, height, (context) => {
			context.drawImage(bitmapA, 0, 0, width, height)
			context.globalCompositeOperation = BLEND_COMPOSITE_OPS[mode] ?? 'source-over'
			context.globalAlpha = opacity / 100
			context.drawImage(bitmapB, 0, 0, width, height)
		})
		bitmapA.close()
		bitmapB.close()
		return { image: result }
	},
}

export const imageAdjustTool: Tool = {
	id: 'image.adjust',
	title: 'Adjust Image',
	description: 'Tune brightness, contrast, and saturation.',
	category: 'process',
	icon: 'process',
	inputs: [
		{ name: 'source', type: 'image', required: true },
		{ name: 'brightness', type: 'number', required: false, default: 0, port: false },
		{ name: 'contrast', type: 'number', required: false, default: 0, port: false },
		{ name: 'saturation', type: 'number', required: false, default: 0, port: false },
	],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs) {
		const image = asImage(inputs.source, 'source')
		// Sliders run -50..50 and map onto CSS filter multipliers of 0..2, where 0 is unchanged.
		const toMultiplier = (value: number) => 1 + value / 50
		const brightness = toMultiplier(asNumber(inputs.brightness, 'brightness', 0))
		const contrast = toMultiplier(asNumber(inputs.contrast, 'contrast', 0))
		const saturation = toMultiplier(asNumber(inputs.saturation, 'saturation', 0))

		const bitmap = await toBitmap(image)
		const result = await renderToImage(bitmap.width, bitmap.height, (context) => {
			context.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`
			context.drawImage(bitmap, 0, 0)
		})
		bitmap.close()
		return { image: result }
	},
}

export const imageUpscaleTool: Tool = {
	id: 'image.upscale',
	title: 'Upscale Image',
	description: 'Enlarge an image in the browser.',
	category: 'process',
	icon: 'process',
	inputs: [
		{ name: 'source', type: 'image', required: true },
		{
			name: 'scale',
			type: 'int',
			required: false,
			default: 2,
			port: false,
			options: [
				{ value: '2', label: '2x' },
				{ value: '4', label: '4x' },
			],
		},
		{
			name: 'method',
			type: 'text',
			required: false,
			default: 'smooth',
			port: false,
			options: [
				{ value: 'smooth', label: 'Smooth' },
				{ value: 'pixel', label: 'Pixel art' },
			],
		},
	],
	outputs: [{ name: 'image', type: 'image' }],
	async run(inputs) {
		const image = asImage(inputs.source, 'source')
		const scale = Number(inputs.scale ?? 2)
		if (scale !== 2 && scale !== 4) throw new Error('scale must be 2 or 4')
		const method = typeof inputs.method === 'string' ? inputs.method : 'smooth'

		if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
			throw new Error('Browser upscaling requires a browser image runtime')
		}
		const bitmap = await createImageBitmap(
			new Blob([image.bytes.buffer as ArrayBuffer], { type: image.mimeType })
		)
		const canvas = document.createElement('canvas')
		canvas.width = bitmap.width * scale
		canvas.height = bitmap.height * scale
		const canvasContext = canvas.getContext('2d')
		if (!canvasContext) throw new Error('Could not create a 2D canvas context')
		// Nearest-neighbour keeps sprite edges crisp; smoothing blurs them.
		canvasContext.imageSmoothingEnabled = method !== 'pixel'
		if (method !== 'pixel') canvasContext.imageSmoothingQuality = 'high'
		canvasContext.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
		bitmap.close()
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('Could not encode image'))),
				'image/png'
			)
		})
		return {
			image: {
				bytes: new Uint8Array(await blob.arrayBuffer()),
				mimeType: 'image/png',
				width: canvas.width,
				height: canvas.height,
			},
		}
	},
}

export const spriteSliceTool: Tool = {
	id: 'sprite.slice',
	title: 'Slice Sprite Sheet',
	description: 'Split an evenly spaced sprite sheet into frames.',
	category: 'process',
	icon: 'process',
	inputs: [
		{ name: 'sheet', type: 'image', required: true },
		{ name: 'rows', type: 'int', required: false, default: 4, port: false },
		{ name: 'cols', type: 'int', required: false, default: 4, port: false },
	],
	outputs: [{ name: 'frames', type: 'image[]' }],
	async run(inputs) {
		const sheet = asImage(inputs.sheet, 'sheet')
		const rows = inputs.rows
		const cols = inputs.cols
		if (typeof rows !== 'number' || !Number.isInteger(rows) || rows <= 0) {
			throw new Error('rows must be a positive integer')
		}
		if (typeof cols !== 'number' || !Number.isInteger(cols) || cols <= 0) {
			throw new Error('cols must be a positive integer')
		}
		if (typeof createImageBitmap !== 'function') {
			throw new Error('sprite.slice requires a browser image runtime')
		}
		const bitmap = await createImageBitmap(
			new Blob([sheet.bytes.buffer as ArrayBuffer], { type: sheet.mimeType })
		)
		const cellWidth = Math.floor(bitmap.width / cols)
		const cellHeight = Math.floor(bitmap.height / rows)
		if (cellWidth <= 0 || cellHeight <= 0) throw new Error('rows and cols exceed the sprite sheet dimensions')
		if (bitmap.width % cols !== 0 || bitmap.height % rows !== 0) {
			bitmap.close()
			throw new Error('sprite sheet dimensions must be divisible by rows and cols')
		}

		const frames: ImageValue[] = []
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				const canvas = document.createElement('canvas')
				canvas.width = cellWidth
				canvas.height = cellHeight
				const context = canvas.getContext('2d')
				if (!context) throw new Error('Could not create a 2D canvas context')
				context.drawImage(
					bitmap,
					col * cellWidth,
					row * cellHeight,
					cellWidth,
					cellHeight,
					0,
					0,
					cellWidth,
					cellHeight
				)
				const blob = await new Promise<Blob>((resolve, reject) => {
					canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Could not encode sprite frame'))), 'image/png')
				})
				frames.push({
					bytes: new Uint8Array(await blob.arrayBuffer()),
					mimeType: 'image/png',
					width: cellWidth,
					height: cellHeight,
				})
			}
		}
		bitmap.close()
		return { frames }
	},
}

export const imagePreviewTool: Tool = {
	id: 'image.preview',
	title: 'Preview Image',
	description: 'Display an image result.',
	category: 'output',
	icon: 'preview',
	inputs: [{ name: 'image', type: 'image', required: true }],
	outputs: [],
	async run(inputs) {
		asImage(inputs.image, 'image')
		return {}
	},
}

export const framesPreviewTool: Tool = {
	id: 'frames.preview',
	title: 'Preview Frames',
	description: 'Inspect a set of animation frames.',
	category: 'output',
	icon: 'preview',
	inputs: [{ name: 'frames', type: 'image[]', required: true }],
	outputs: [],
	async run(inputs) {
		if (!Array.isArray(inputs.frames)) throw new Error('frames must be an image array')
		return {}
	},
}

/** Decode a frame to raw RGBA pixels, which is the only form the GIF quantizer accepts. */
async function readPixels(
	image: ImageValue,
	label: string
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
	const bitmap = await createImageBitmap(
		new Blob([image.bytes.buffer as ArrayBuffer], { type: image.mimeType })
	)
	try {
		const canvas = document.createElement('canvas')
		canvas.width = bitmap.width
		canvas.height = bitmap.height
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error(`Could not create a 2D canvas context for ${label}`)
		context.drawImage(bitmap, 0, 0)
		const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
		return { data, width: bitmap.width, height: bitmap.height }
	} finally {
		bitmap.close()
	}
}

/**
 * A pixel sample across every frame, used to build one palette for the whole animation.
 *
 * A per-frame palette makes flat colours shift slightly between frames, which reads as flicker.
 * Sampling is capped because quantizing every pixel of a long, large animation is slow and adds
 * nothing: a palette only needs a representative spread of colours, not all of them.
 */
function samplePalettePixels(
	frames: readonly { data: Uint8ClampedArray }[],
	maxPixels = 1 << 20
): Uint8ClampedArray {
	const total = frames.reduce((sum, frame) => sum + frame.data.length / 4, 0)
	const stride = Math.max(1, Math.ceil(total / maxPixels))
	const sampled = new Uint8ClampedArray(Math.ceil(total / stride) * 4)
	let out = 0
	let pixel = 0
	for (const frame of frames) {
		for (let i = 0; i < frame.data.length; i += 4, pixel++) {
			if (pixel % stride !== 0) continue
			sampled[out++] = frame.data[i]
			sampled[out++] = frame.data[i + 1]
			sampled[out++] = frame.data[i + 2]
			sampled[out++] = frame.data[i + 3]
		}
	}
	return sampled.subarray(0, out)
}

/** GIF transparency is 1-bit, so anything meaningfully see-through counts. */
function hasTransparency(data: Uint8ClampedArray): boolean {
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] < 128) return true
	}
	return false
}

export const framesGifTool: Tool = {
	id: 'frames.gif',
	title: 'Compose GIF',
	description: 'Combine frames into an animated GIF.',
	category: 'process',
	icon: 'process',
	inputs: [
		{ name: 'frames', type: 'image[]', required: true },
		{ name: 'fps', type: 'int', required: false, default: 12, port: false },
		{
			name: 'loop',
			type: 'text',
			required: false,
			default: 'forever',
			port: false,
			options: [
				{ value: 'forever', label: 'Loop forever' },
				{ value: 'once', label: 'Play once' },
			],
		},
	],
	outputs: [{ name: 'gif', type: 'image' }],
	async run(inputs) {
		const frames = inputs.frames
		if (!Array.isArray(frames)) throw new Error('frames must be an image array')
		if (frames.length === 0) throw new Error('frames must contain at least one image')
		const images = frames.map((frame, index) => asImage(frame as ToolValue, `frame ${index + 1}`))

		const fps = inputs.fps
		// GIF stores delay in hundredths of a second, so above 50fps the rounded delay collapses
		// toward zero and viewers substitute their own default rate.
		if (typeof fps !== 'number' || !Number.isInteger(fps) || fps < 1 || fps > 50) {
			throw new Error('fps must be an integer between 1 and 50')
		}
		const loop = inputs.loop === 'once' ? -1 : 0

		if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
			throw new Error('frames.gif requires a browser image runtime')
		}

		const pixels = await Promise.all(
			images.map((image, index) => readPixels(image, `frame ${index + 1}`))
		)
		const { width, height } = pixels[0]
		// A GIF has one canvas size. Scaling silently would quietly change the user's art, so a
		// mismatch is reported with both sizes rather than guessed at.
		const odd = pixels.findIndex((frame) => frame.width !== width || frame.height !== height)
		if (odd > 0) {
			throw new Error(
				`every frame must be the same size: frame 1 is ${width}x${height} but frame ${odd + 1} is ${pixels[odd].width}x${pixels[odd].height}`
			)
		}

		const transparent = pixels.some((frame) => hasTransparency(frame.data))
		const format = transparent ? 'rgba4444' : 'rgb565'
		const palette = quantize(samplePalettePixels(pixels), 256, {
			format,
			oneBitAlpha: transparent,
		})
		const transparentIndex = transparent
			? palette.findIndex((colour) => (colour[3] ?? 255) === 0)
			: -1

		const encoder = GIFEncoder()
		const delay = Math.round(1000 / fps)
		pixels.forEach((frame, index) => {
			const indexed = applyPalette(frame.data, palette, format)
			encoder.writeFrame(indexed, width, height, {
				// Only the first frame carries the palette. gifenc writes a per-frame local colour
				// table for any later frame that supplies one, which would repeat 256 colours per
				// frame for no benefit.
				...(index === 0 ? { palette, repeat: loop } : {}),
				delay,
				transparent: transparentIndex >= 0,
				transparentIndex: Math.max(0, transparentIndex),
			})
		})
		encoder.finish()

		return {
			gif: { bytes: encoder.bytes(), mimeType: 'image/gif', width, height },
		}
	},
}

export const imageDownloadTool: Tool = {
	id: 'image.download',
	title: 'Download Image',
	description: 'Download an image to the local machine.',
	category: 'output',
	icon: 'download',
	inputs: [
		{ name: 'image', type: 'image', required: true },
		{ name: 'filename', type: 'text', required: false, default: 'out.png', port: false },
	],
	outputs: [],
	async run(inputs) {
		const image = asImage(inputs.image, 'image')
		downloadBytes(
			image.bytes,
			image.mimeType,
			// The default filename says .png, but the graph can now produce a GIF or a JPEG. Saving
			// GIF bytes as "out.png" gives a file the OS opens with the wrong app.
			withMatchingExtension(asString(inputs.filename, 'filename'), image.mimeType)
		)
		return {}
	},
}


export const framesDownloadZipTool: Tool = {
	id: 'frames.downloadZip',
	title: 'Download Frames ZIP',
	description: 'Package animation frames into a ZIP archive.',
	category: 'output',
	icon: 'download',
	inputs: [
		{ name: 'frames', type: 'image[]', required: true },
		{ name: 'filename', type: 'text', required: false, default: 'sprites.zip', port: false },
	],
	outputs: [],
	async run(inputs) {
		if (!Array.isArray(inputs.frames)) throw new Error('frames must be an image array')
		const files: Record<string, Uint8Array> = {}
		inputs.frames.forEach((value, index) => {
			files[`frame-${String(index + 1).padStart(3, '0')}.png`] = asImage(value, `frames[${index}]`).bytes
		})
		downloadBytes(zipSync(files), 'application/zip', asString(inputs.filename, 'filename'))
		return {}
	},
}

export const canvasSketchTool: Tool = {
	id: 'canvas.sketch',
	title: 'Sketch',
	description: 'Turn whatever you draw inside this block into an image.',
	category: 'input',
	icon: 'image',
	canvasRegion: true,
	inputs: [],
	outputs: [{ name: 'image', type: 'image' }],
	async run(_inputs, context) {
		if (!context.canvas) {
			throw new Error('Sketch blocks can only run on the canvas, which this run has no access to')
		}
		const image = await context.canvas.captureRegion()
		// Strokes are never written to the workflow file, so a reopened sketch pipeline starts
		// empty. Saying so beats emitting null and failing somewhere further down the chain.
		if (!image) {
			throw new Error(
				'Nothing to sketch. Draw inside this block first — sketches are not saved with the workflow.'
			)
		}
		return { image }
	},
}

export const builtinTools: readonly Tool[] = [
	constTextTool,
	constImageTool,
	canvasSketchTool,
	promptLiquidTool,
	imageGenerateTool,
	imageRemoveBackgroundTool,
	imageAdjustTool,
	imageBlendTool,
	imageUpscaleTool,
	spriteSliceTool,
	framesGifTool,
	imagePreviewTool,
	framesPreviewTool,
	imageDownloadTool,
	framesDownloadZipTool,
]

