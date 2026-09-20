import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { type Connect, loadEnv, type Plugin } from 'vite'
import { createEnv } from './env.ts'
import { errorMessage, errorStatus } from './httpError.ts'
import { router } from './router.ts'

/**
 * Bridge a Node request into the Web `Request` that itty-router expects.
 */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

	const headers = new Headers()
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue
		for (const entry of Array.isArray(value) ? value : [value]) headers.append(key, entry)
	}

	const method = req.method ?? 'GET'
	if (method === 'GET' || method === 'HEAD') {
		return new Request(url, { method, headers })
	}

	// Buffer the body: the request handlers read it whole anyway, and this
	// avoids needing duplex streaming support.
	const chunks: Buffer[] = []
	for await (const chunk of req) chunks.push(chunk as Buffer)
	const body = Buffer.concat(chunks)

	return new Request(url, {
		method,
		headers,
		body: body.length > 0 ? new Uint8Array(body) : undefined,
	})
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
	res.statusCode = response.status
	response.headers.forEach((value, key) => res.setHeader(key, value))
	if (!response.body) {
		res.end()
		return
	}
	Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
}

/**
 * Serves the local API from inside the Vite server.
 *
 * The app is a local development tool, so its backend needs the filesystem —
 * it reads and writes the project's version-controlled `pipelines/` directory
 * and caches generated images on disk. Running the API in-process keeps that
 * to a single `npm run dev` with no separate server to start.
 */
export function localApiPlugin(): Plugin {
	return {
		name: 'image-pipeline-local-api',
		configureServer(server) {
			server.middlewares.use(createMiddleware(server.config.root, server.config.mode))
		},
		configurePreviewServer(server) {
			server.middlewares.use(createMiddleware(server.config.root, server.config.mode))
		},
	}
}

function createMiddleware(root: string, mode: string): Connect.NextHandleFunction {
	// An empty prefix loads every key, not just the client-exposed `VITE_` ones.
	// Secrets stay server-side because this record never reaches the bundle.
	const env = createEnv(root, loadEnv(mode, root, ''))
	return (req, res, next) => {
		const url = req.url ?? ''
		if (!url.startsWith('/api/') && !url.startsWith('/pipelines/')) return next()

		void (async () => {
			try {
				const response = await router.fetch(await toWebRequest(req), env)
				await writeWebResponse(response, res)
			} catch (e) {
				console.error(e)
				res.statusCode = errorStatus(e)
				res.end(JSON.stringify({ error: errorMessage(e) }))
			}
		})()
	}
}
