import { IRequest } from 'itty-router'
import { Env } from '../env.ts'
import { availableModels, MODELS, providerCredentialProblem } from '../models.ts'

/**
 * GET /api/models
 *
 * The models this server can actually call, given its configured credentials.
 * The client uses this to build the model picker, so an unconfigured provider's
 * models are never offered.
 */
export async function handleModelList(_request: IRequest, env: Env) {
	const available = availableModels(env)
	return new Response(
		JSON.stringify({
			models: available,
			// Surfaced so the UI can explain an empty or short list rather than
			// silently showing nothing. The reason matters more than the absence:
			// "your token expired" is actionable, "no models" is not.
			unavailable: MODELS.filter((model) => !available.includes(model)).map((model) => ({
				id: model.id,
				provider: model.provider,
				reason: providerCredentialProblem(model.provider, env),
			})),
		}),
		{ headers: { 'Content-Type': 'application/json' } }
	)
}
