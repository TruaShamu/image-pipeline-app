import { Env } from '../env.ts'

export interface GenerateParams {
	modelId: string
	prompt: string
	referenceImageUrl?: string
	/** Pixel dimensions, e.g. `1024x1024`. Azure requires both sides divisible by 16. */
	size?: string
	/** Rendering effort: `low`, `medium`, `high`, or `auto`. */
	quality?: string
	/** `transparent`, `opaque`, or `auto`. Transparency requires a PNG output format. */
	background?: string
	/** `png` or `jpeg`. */
	outputFormat?: string
	/** 0-100, ignored unless the output format is lossy. */
	outputCompression?: number
}

export interface GenerateResult {
	imageUrl: string
}

export interface ImageProvider {
	name: string
	generate(params: GenerateParams, env: Env): Promise<GenerateResult>
}

/**
 * Resolve an image URL (data URL, R2 path, or external URL) into a Blob
 * and a data URL that external APIs can consume.
 */
export async function resolveImage(
	url: string,
	env: Env
): Promise<{ blob: Blob; dataUrl: string }> {
	if (url.startsWith('data:')) {
		const [header, data] = url.split(',')
		const mimeMatch = header.match(/data:([^;]+)/)
		const mime = mimeMatch?.[1] ?? 'image/png'
		if (header.includes('base64')) {
			const binary = atob(data)
			const bytes = new Uint8Array(binary.length)
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i)
			}
			return { blob: new Blob([bytes], { type: mime }), dataUrl: url }
		}
		const decoded = decodeURIComponent(data)
		const bytes = new TextEncoder().encode(decoded)
		const b64 = arrayBufferToBase64(bytes.buffer as ArrayBuffer)
		return {
			blob: new Blob([bytes], { type: mime }),
			dataUrl: `data:${mime};base64,${b64}`,
		}
	}

	// Locally cached generated image — read straight off disk
	if (url.startsWith('/api/images/') && env.images) {
		const imageId = url.slice('/api/images/'.length)
		const image = await env.images.get(imageId)
		if (!image) throw new Error(`Image not found in cache: ${imageId}`)
		const buf = image.data.buffer.slice(
			image.data.byteOffset,
			image.data.byteOffset + image.data.byteLength
		) as ArrayBuffer
		return {
			blob: new Blob([buf], { type: image.contentType }),
			dataUrl: `data:${image.contentType};base64,${arrayBufferToBase64(buf)}`,
		}
	}

	// External URL
	const res = await fetch(url)
	if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`)
	const buf = await res.arrayBuffer()
	const mime = res.headers.get('content-type') ?? 'image/png'
	return {
		blob: new Blob([buf], { type: mime }),
		dataUrl: `data:${mime};base64,${arrayBufferToBase64(buf)}`,
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	const chunks: string[] = []
	const chunkSize = 8192
	for (let i = 0; i < bytes.length; i += chunkSize) {
		chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
	}
	return btoa(chunks.join(''))
}
