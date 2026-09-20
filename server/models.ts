import { Env } from './env.ts'

/** Which backend a model is served by. Determines the credentials it needs. */
export type ModelProvider = 'openai'

export interface ModelDefinition {
	/** The `provider:model` string used by `/api/generate`. */
	id: string
	label: string
	provider: ModelProvider
}

/**
 * The models this server can reach.
 *
 * The list lives here, next to the provider code that has to satisfy it, rather
 * than in the client. The UI asks the server what is available instead of
 * hardcoding a menu, so a model can never be offered that the server cannot
 * actually call.
 *
 * Every entry is an Azure OpenAI deployment, and the GPT Image family accepts a
 * reference image, so there is no per-model capability flag to track.
 */
export const MODELS: readonly ModelDefinition[] = [
	{ id: 'openai:gpt-image-1.5', label: 'Azure OpenAI · GPT Image 1.5', provider: 'openai' },
	{ id: 'openai:gpt-image-2', label: 'Azure OpenAI · GPT Image 2', provider: 'openai' },
	{
		id: 'openai:gpt-image-2.5-flare',
		label: 'Azure OpenAI · GPT Image 2.5 Flare',
		provider: 'openai',
	},
	{
		id: 'openai:gpt-image-2.5-sunburst',
		label: 'Azure OpenAI · GPT Image 2.5 Sunburst',
		provider: 'openai',
	},
]

/** Whether the credentials for a provider are present in the environment. */
export function isProviderConfigured(provider: ModelProvider, env: Env): boolean {
	return providerCredentialProblem(provider, env) === null
}

/**
 * Milliseconds since the epoch at which a bearer token stops being accepted, if it says.
 *
 * Azure's tokens are JWTs, so the expiry is already in the caller's hand — no network round trip
 * is needed to know a token is dead.
 */
function bearerTokenExpiry(token: string): number | null {
	const payload = token.split('.')[1]
	if (!payload) return null
	try {
		const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
			exp?: unknown
		}
		return typeof claims.exp === 'number' ? claims.exp * 1000 : null
	} catch {
		// An opaque token is not necessarily invalid, so this is "cannot tell", not "expired".
		return null
	}
}

/**
 * Why this provider cannot currently be called, or `null` when it can.
 *
 * Checking that a credential *exists* is not the same as checking it still *works*. A bearer token
 * from `npm run token` lasts about an hour, so a session that started before lunch will happily
 * report every model as available while every call returns 401. Reading the token's own expiry
 * closes that gap, and names the one command that fixes it.
 */
export function providerCredentialProblem(_provider: ModelProvider, env: Env): string | null {
	if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET) return null
	if (env.AZURE_OPENAI_TOKEN) {
		const expiresAt = bearerTokenExpiry(env.AZURE_OPENAI_TOKEN)
		if (expiresAt !== null && expiresAt <= Date.now()) {
			return 'AZURE_OPENAI_TOKEN has expired. Run `npm run token` to refresh it.'
		}
		return null
	}
	if (env.AZURE_OPENAI_API_KEY) return null
	return 'No Azure OpenAI credentials configured. Run `npm run token`, or set a service principal or API key in .env.'
}

/** Only the models this server currently has working credentials for. */
export function availableModels(env: Env): ModelDefinition[] {
	return MODELS.filter((model) => isProviderConfigured(model.provider, env))
}
