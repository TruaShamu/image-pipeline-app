import { Env } from '../env.ts'
import { HttpError } from '../httpError.ts'
import { resolveImage } from './types.ts'
import type { GenerateParams, GenerateResult, ImageProvider } from './types.ts'

/**
 * Azure OpenAI image provider (GPT Image family).
 *
 * The target resource may have key-based auth disabled, so this provider
 * authenticates with Entra ID (Azure AD) bearer tokens. It
 * resolves credentials in the following order:
 *
 *   1. Client credentials (AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET)
 *      — a service principal token is fetched and cached. Best for deployment.
 *   2. A static bearer token (AZURE_OPENAI_TOKEN) — refresh locally with
 *      `npm run token` (runs `az account get-access-token`). Expires ~1h.
 *   3. An API key (AZURE_OPENAI_API_KEY) — only works if the resource has
 *      key-based auth enabled.
 *
 * The Model node's `modelId` maps directly to the Azure deployment name
 * (e.g. `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2.5-flare`,
 * `gpt-image-2.5-sunburst`).
 */
export const openai: ImageProvider = {
	name: 'openai',

	async generate(params: GenerateParams, env: Env): Promise<GenerateResult> {
		const deployment = params.modelId || 'gpt-image-1.5'
		const endpoint = requireEndpoint(env)
		const apiVersion = env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview'
		const authHeaders = await getAuthHeaders(env)

		// When a reference image is connected, use the image edits endpoint so
		// GPT Image can transform the input; otherwise use plain generation.
		if (params.referenceImageUrl) {
			return editImage(params, { endpoint, deployment, apiVersion, authHeaders }, env)
		}

		const url = `${endpoint}/openai/deployments/${deployment}/images/generations?api-version=${apiVersion}`
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...authHeaders },
			body: JSON.stringify({
				prompt: params.prompt,
				n: 1,
				...imageOptions(params),
			}),
		})

		if (!res.ok) {
			throw azureError('Azure OpenAI error', res.status, await res.text())
		}

		const data = (await res.json()) as AzureImageResponse
		return { imageUrl: extractImageUrl(data) }
	},
}

/**
 * The optional generation settings, omitting any the caller left unset.
 *
 * Azure rejects an explicit `undefined`, and defaults differ between deployments, so an unset
 * control means "let the model decide" rather than a value chosen here.
 */
function imageOptions(params: GenerateParams): Record<string, string | number> {
	return {
		...(params.size ? { size: params.size } : {}),
		...(params.quality ? { quality: params.quality } : {}),
		...(params.background ? { background: params.background } : {}),
		...(params.outputFormat ? { output_format: params.outputFormat } : {}),
		...(params.outputCompression === undefined
			? {}
			: { output_compression: params.outputCompression }),
	}
}

interface AzureCallContext {
	endpoint: string
	deployment: string
	apiVersion: string
	authHeaders: Record<string, string>
}

/** Transform a reference image with GPT Image via the /images/edits endpoint. */
async function editImage(
	params: GenerateParams,
	ctx: AzureCallContext,
	env: Env
): Promise<GenerateResult> {
	const { blob } = await resolveImage(params.referenceImageUrl!, env)
	const form = new FormData()
	form.append('image', blob, 'image.png')
	form.append('prompt', params.prompt)
	form.append('n', '1')
	// The edits endpoint takes the same settings, as multipart fields rather than JSON.
	for (const [key, value] of Object.entries(imageOptions(params))) {
		form.append(key, String(value))
	}

	const url = `${ctx.endpoint}/openai/deployments/${ctx.deployment}/images/edits?api-version=${ctx.apiVersion}`
	const res = await fetch(url, {
		method: 'POST',
		// Let fetch set the multipart boundary; only pass auth headers.
		headers: { ...ctx.authHeaders },
		body: form,
	})

	if (!res.ok) {
		throw azureError('Azure OpenAI edit error', res.status, await res.text())
	}

	const data = (await res.json()) as AzureImageResponse
	return { imageUrl: extractImageUrl(data) }
}

interface AzureImageResponse {
	data: Array<{ b64_json?: string; url?: string }>
}

/**
 * Turn an Azure failure into one the caller can act on.
 *
 * A 401 here is almost always the hour-long bearer token ageing out mid-session, so the message
 * names the command that fixes it rather than only reporting what broke. The status is carried
 * through so the browser sees 401 rather than a 500 that looks like a bug in this server.
 */
function azureError(label: string, status: number, body: string): HttpError {
	const hint =
		status === 401 ? ' — the Azure token has likely expired, run `npm run token`' : ''
	return new HttpError(status, `${label} ${status}${hint}: ${azureErrorMessage(body)}`)
}

/**
 * The human-readable sentence out of an Azure error body.
 *
 * Azure wraps its message in `{ error: { message } }`. Passing the raw JSON through would put a
 * wall of escaped braces in front of the one sentence that says what to change.
 */
function azureErrorMessage(body: string): string {
	try {
		const parsed = JSON.parse(body) as { error?: { message?: string } }
		return parsed.error?.message ?? body
	} catch {
		// A non-JSON body is already the best text available, e.g. an HTML gateway error.
		return body
	}
}

/** GPT Image returns base64; fall back to a URL if a deployment returns one. */
function extractImageUrl(data: AzureImageResponse): string {
	const first = data.data?.[0]
	if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`
	if (first?.url) return first.url
	throw new Error('Azure OpenAI returned no image data')
}

function requireEndpoint(env: Env): string {
	const endpoint = env.AZURE_OPENAI_ENDPOINT
	if (!endpoint) {
		// Missing configuration is not a server fault, and not something a retry will fix.
		throw new HttpError(
			503,
			'AZURE_OPENAI_ENDPOINT is not set. Copy .env.example to .env and set it.'
		)
	}
	return endpoint.replace(/\/$/, '')
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAuthHeaders(env: Env): Promise<Record<string, string>> {
	if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET) {
		return { Authorization: `Bearer ${await getClientCredentialsToken(env)}` }
	}
	if (env.AZURE_OPENAI_TOKEN) {
		return { Authorization: `Bearer ${env.AZURE_OPENAI_TOKEN}` }
	}
	if (env.AZURE_OPENAI_API_KEY) {
		return { 'api-key': env.AZURE_OPENAI_API_KEY }
	}
	throw new HttpError(
		503,
		'No Azure OpenAI credentials configured. Set AZURE_OPENAI_TOKEN (run `npm run token`), ' +
			'a service principal (AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET), or AZURE_OPENAI_API_KEY.'
	)
}

async function getClientCredentialsToken(env: Env): Promise<string> {
	const now = Date.now()
	if (cachedToken && cachedToken.expiresAt > now + 60_000) {
		return cachedToken.value
	}

	const tokenUrl = `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`
	const body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: env.AZURE_CLIENT_ID!,
		client_secret: env.AZURE_CLIENT_SECRET!,
		scope: 'https://cognitiveservices.azure.com/.default',
	})

	const res = await fetch(tokenUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	})

	if (!res.ok) {
		throw new Error(`Failed to acquire Azure AD token ${res.status}: ${await res.text()}`)
	}

	const json = (await res.json()) as { access_token: string; expires_in: number }
	cachedToken = {
		value: json.access_token,
		expiresAt: now + json.expires_in * 1000,
	}
	return cachedToken.value
}
