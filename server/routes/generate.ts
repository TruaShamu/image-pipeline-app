import { IRequest } from 'itty-router'
import { createHash } from 'node:crypto'
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
	/** How many images to generate. Defaults to 1. */
	n?: number
	/**
	 * Generate fresh images instead of reusing a previous result for these same parameters.
	 *
	 * Generation has no seed, so identical parameters normally return a cached image. Asking for
	 * a new sample has to be explicit, because most reruns want the pipeline to be reproducible.
	 */
	refresh?: boolean
}

/**
 * POST /api/generate
 *
 * Calls an AI image generation provider and returns the generated images.
 * Supports multiple providers via the model string format "provider:model".
 *
 * Returns: { imageUrls: string[] } — always a list, even for a single image.
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
		n: body.n,
	}

	// Reuse a previous result for these exact parameters. Generation is the slow, costly step, so
	// rerunning an unchanged pipeline should cost nothing — the same reasoning a build cache uses.
	const cacheKey = generationCacheKey(params)
	const count = Math.max(1, params.n ?? 1)
	if (!body.refresh) {
		const cached = await readCachedImages(cacheKey, count, env)
		if (cached) {
			return new Response(JSON.stringify({ imageUrls: cached, cached: true }), {
				headers: { 'Content-Type': 'application/json' },
			})
		}
	}

	const result = await provider.generate(params, env)

	// Cache each image on disk so they survive a page reload.
	const imageUrls = await Promise.all(
		result.imageUrls.map((imageUrl, index) => cacheImage(imageUrl, cacheKey, index, env))
	)

	return new Response(JSON.stringify({ imageUrls }), {
		headers: { 'Content-Type': 'application/json' },
	})
}

/**
 * A stable id for one image of one generation request.
 *
 * `n` is deliberately excluded from the key and carried in the index instead, so asking for two
 * images and later asking for one reuses the first image rather than missing entirely.
 */
function generationCacheKey(params: GenerateParams): string {
	const { n: _n, ...keyed } = params
	// Sorted keys, because a JSON object's field order must not change the identity of a request.
	const canonical = JSON.stringify(keyed, Object.keys(keyed).sort())
	return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

function cachedImageId(cacheKey: string, index: number): string {
	return `gen_${cacheKey}_${index}`
}

/**
 * The cached images for a request, or null when any of them is missing.
 *
 * All or nothing: a partial hit would mix a cached image with a fresh one in a single batch, and
 * those are meant to be variations of each other.
 */
async function readCachedImages(
	cacheKey: string,
	count: number,
	env: Env
): Promise<string[] | null> {
	if (!env.images) return null
	const ids = Array.from({ length: count }, (_, index) => cachedImageId(cacheKey, index))
	const present = await Promise.all(ids.map((id) => env.images.has(id)))
	if (present.some((exists) => !exists)) return null
	return ids.map((id) => `/api/images/${id}`)
}

/** Store a freshly generated image and return the URL it can be re-read from. */
async function cacheImage(
	imageUrl: string,
	cacheKey: string,
	index: number,
	env: Env
): Promise<string> {
	if (!env.images || !imageUrl.startsWith('data:')) return imageUrl
	// Keyed by the request rather than the clock, so an unchanged rerun reads this back instead of
	// paying for another generation. A refresh overwrites it, making the newest sample the one a
	// later cached run returns.
	const imageId = cachedImageId(cacheKey, index)
	await env.images.put(imageId, Buffer.from(dataUrlToBytes(imageUrl)), 'image/png')
	return `/api/images/${imageId}`
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
