import fs from 'node:fs/promises'
import path from 'node:path'
import { IRequest } from 'itty-router'
import { Env } from '../env.ts'
import { isPipelineKind, PipelineStore } from '../storage/pipelineStore.ts'

/**
 * Endpoints for version-controlled pipeline content.
 *
 * Workflows and prompt presets are plain YAML files in the project's
 * `pipelines/` directory. They are meant to be committed to git and shared by
 * a team, so these routes are a thin wrapper over the filesystem — a directory
 * listing is the catalog, and saving is just writing a file.
 */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function store(env: Env): PipelineStore {
	return new PipelineStore(env.pipelinesDir)
}

/** GET /api/pipelines/:kind — every file of a kind, with its YAML body. */
export async function handlePipelineList(request: IRequest, env: Env) {
	const { kind } = request.params
	if (!isPipelineKind(kind)) return json({ error: `Unknown kind "${kind}"` }, 404)
	return json({ files: await store(env).list(kind) })
}

/** PUT /api/pipelines/:kind/:id — create or overwrite a file. */
export async function handlePipelineSave(request: IRequest, env: Env) {
	const { kind, id } = request.params
	if (!isPipelineKind(kind)) return json({ error: `Unknown kind "${kind}"` }, 404)
	const body = (await request.json()) as { yaml?: unknown }
	if (typeof body.yaml !== 'string') return json({ error: 'yaml is required' }, 400)
	try {
		return json(await store(env).save(kind, id, body.yaml))
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : 'Save failed' }, 400)
	}
}

/** DELETE /api/pipelines/:kind/:id */
export async function handlePipelineDelete(request: IRequest, env: Env) {
	const { kind, id } = request.params
	if (!isPipelineKind(kind)) return json({ error: `Unknown kind "${kind}"` }, 404)
	const deleted = await store(env).delete(kind, id)
	if (!deleted) return json({ error: 'Not found' }, 404)
	return json({ ok: true })
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
}

/**
 * GET /pipelines/* — static assets stored next to the YAML.
 *
 * Prompt presets reference sample images by path, and those images are
 * committed alongside the presets, so they are served from the same directory
 * rather than from the app's bundled `public/` folder.
 */
export async function handlePipelineAsset(request: IRequest, env: Env) {
	const relative = new URL(request.url).pathname.slice('/pipelines/'.length)
	const full = store(env).resolveAsset(decodeURIComponent(relative))
	if (!full) return new Response('Not found', { status: 404 })

	const contentType = ASSET_CONTENT_TYPES[path.extname(full).toLowerCase()]
	if (!contentType) return new Response('Not found', { status: 404 })

	try {
		const data = await fs.readFile(full)
		return new Response(new Uint8Array(data), {
			headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
		})
	} catch {
		return new Response('Not found', { status: 404 })
	}
}
