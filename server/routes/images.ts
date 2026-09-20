import { IRequest } from 'itty-router'
import { Env } from '../env.ts'

/**
 * POST /api/images/:imageId
 *
 * Store a generated image in the local cache.
 */
export async function handleImageUpload(request: IRequest, env: Env) {
	const { imageId } = request.params
	const contentType = request.headers.get('content-type') ?? 'image/png'

	if (!contentType.startsWith('image/')) {
		return new Response(JSON.stringify({ error: 'Invalid content type' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	// Don't overwrite existing images.
	if (await env.images.has(imageId)) {
		return new Response(JSON.stringify({ ok: true }), {
			headers: { 'Content-Type': 'application/json' },
		})
	}

	const body = Buffer.from(await request.arrayBuffer())
	await env.images.put(imageId, body, contentType)

	return new Response(JSON.stringify({ ok: true }), {
		headers: { 'Content-Type': 'application/json' },
	})
}

/**
 * GET /api/images/:imageId
 *
 * Read a generated image back out of the local cache.
 */
export async function handleImageDownload(request: IRequest, env: Env) {
	const { imageId } = request.params

	const image = await env.images.get(imageId)
	if (!image) {
		return new Response('Not found', { status: 404 })
	}

	return new Response(new Uint8Array(image.data), {
		headers: {
			'content-type': image.contentType,
			// Ids are unique per generation, so the bytes behind one never change.
			'cache-control': 'public, max-age=31536000, immutable',
		},
	})
}
