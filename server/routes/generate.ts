import { IRequest } from 'itty-router'
import { Env } from '../env.ts'
import { getProvider } from '../providers/index.ts'
import type { GenerateParams } from '../providers/index.ts'

/**
 * Request body for the /api/generate endpoint.
 */
interface GenerateRequest {
	/** The provider:model string, e.g. "openai:gpt-image-1.5" */
	model: string
	/** The text prompt describing the desired image */
	prompt: string
	/** Reference image, which turns the call into an image-to-image edit */
	referenceImageUrl?: string
	/** Pixel dimensions, e.g. "1024x1024" */
	size?: string
	/** Rendering effort: low, medium, high, auto */
	quality?: string
	/** transparent, opaque, auto */
	background?: string
	/** png or jpeg */
	outputFormat?: string
	/** 0-100, only meaningful for a lossy output format */
	outputCompression?: number
}

/**
 * POST /api/generate
 *
 * Calls an AI image generation provider and returns the generated image.
 * Supports multiple providers via the model string format "provider:model".
 *
 * Returns: { imageUrl: string }
 */
export async function handleGenerate(request: IRequest, env: Env) {
	const body = (await request.json()) as GenerateRequest

	if (!body.prompt) {
		return new Response(JSON.stringify({ error: 'prompt is required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const [providerName, modelId] = (body.model ?? 'openai:gpt-image-1.5').split(':')

	// Failures propagate to the router's error handler, which preserves the upstream status. A
	// local catch here previously flattened everything to 500, so an expired token was
	// indistinguishable from a bug in this server.
	const provider = getProvider(providerName)
	const params: GenerateParams = {
		modelId: modelId ?? '',
		prompt: body.prompt,
		referenceImageUrl: body.referenceImageUrl,
		size: body.size,
		quality: body.quality,
		background: body.background,
		outputFormat: body.outputFormat,
		outputCompression: body.outputCompression,
	}

	let result = await provider.generate(params, env)

	// Cache the image on disk so it survives a page reload.
	if (env.images && result.imageUrl?.startsWith('data:')) {
		const imageId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		const bytes = dataUrlToBytes(result.imageUrl)
		await env.images.put(imageId, Buffer.from(bytes), 'image/png')
		result = { ...result, imageUrl: `/api/images/${imageId}` }
	}

	return new Response(JSON.stringify(result), {
		headers: { 'Content-Type': 'application/json' },
	})
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const [header, base64] = dataUrl.split(',')
	if (header.includes('base64')) {
		return new Uint8Array(Buffer.from(base64, 'base64'))
	}
	// For SVG data URLs, just encode as UTF-8
	return new TextEncoder().encode(decodeURIComponent(base64))
}
